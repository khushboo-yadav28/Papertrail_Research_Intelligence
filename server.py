"""Local-first research paper intelligence app. Run with: python server.py"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, re, sqlite3, uuid, hashlib, html, os, sys, base64, binascii

ROOT = Path(__file__).parent
VENDOR = ROOT / 'vendor'
if VENDOR.exists(): sys.path.insert(0, str(VENDOR))
DATA = ROOT / 'data'
UPLOADS = DATA / 'papers'
DB = DATA / 'research.db'
UPLOADS.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

FIELDS = {
 'objective': ['objective','aim','purpose','research question','we investigate','this study'],
 'method': ['method','methodology','approach','proposed','algorithm','model'],
 'dataset': ['dataset','corpus','benchmark','participants','samples'],
 'setup': ['experimental setup','evaluation','metrics','metric','experiment'],
 'results': ['result','findings','outperformed','achieved','improved','accuracy','we found'],
 'limitations': ['limitation','future work','future research','however','drawback','challenge']
}
ENTITY_TERMS = {
 'Methods & models': ['transformer','bert','cnn','rnn','random forest','svm','neural network','retrieval-augmented','fine-tuning','regression','clustering','classification'],
 'Datasets': ['glue','squad','imagenet','mnist','cifar-10','wikitext','common crawl','pubmed','mimic-iii'],
 'Metrics': ['accuracy','f1-score','precision','recall','bleu','rouge','auc','rmse','mae','perplexity'],
 'Tasks & domains': ['question answering','sentiment analysis','classification','summarization','healthcare','clinical','education','finance','language model']
}

def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row
 c.execute('CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY,title TEXT,filename TEXT,sha TEXT UNIQUE,text TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP)'); c.commit(); return c

def sentences(text):
 return [s.strip() for s in re.split(r'(?<=[.!?])\s+|\n+', text) if len(s.strip()) > 35]

def section_index(text):
 """Best-effort heading detection from extracted PDF text; never invent headings."""
 lines=text.splitlines(); marks=[]
 for i,line in enumerate(lines):
  s=line.strip()
  if not s or len(s)>90 or len(s)<3: continue
  numbered=re.match(r'^(?:\d+(?:\.\d+)*[.)]?\s+)([A-Z][A-Za-z0-9 ,:&()/-]+)$',s)
  named=s.lower() in {'abstract','introduction','background','related work','method','methods','methodology','materials and methods','experimental setup','experiments','results','discussion','limitations','conclusion','conclusions','future work','references'}
  upper=(s.isupper() and re.search(r'[A-Z]',s) and len(s.split())<=9)
  if numbered or named or upper: marks.append((i,s))
 out=[]
 for j,(start,title) in enumerate(marks):
  stop=marks[j+1][0] if j+1<len(marks) else len(lines)
  body=' '.join(x.strip() for x in lines[start+1:stop] if x.strip())
  if body: out.append({'heading':title,'passages':len(sentences(body)),'excerpt':body[:260]})
 return out

def analyze(text):
 ss=sentences(text); claims={}
 for field, keys in FIELDS.items():
  picks=[]
  for s in ss:
   low=s.lower()
   if any(k in low for k in keys):
    picks.append({'text':s[:650], 'page': page_for(text,s), 'confidence': round(min(.96,.55+sum(k in low for k in keys)*.08),2)})
   if len(picks)>=4: break
  claims[field]=picks
 ents={cat:sorted({term for term in terms if re.search(r'\b'+re.escape(term)+r'\b',text,re.I)}) for cat,terms in ENTITY_TERMS.items()}
 ents={k:v for k,v in ents.items() if v}
 return claims,ents

def topic_model(texts):
 """Fit a small corpus-specific LDA model; return interpretable high-weight terms."""
 corpus=[t for t in texts if len(terms(t))>=8]
 if len(corpus)<3:return []
 try:
  from sklearn.decomposition import LatentDirichletAllocation
  from sklearn.feature_extraction.text import CountVectorizer
  vec=CountVectorizer(stop_words='english',max_df=1.0,min_df=1,ngram_range=(1,2),max_features=1200)
  matrix=vec.fit_transform(corpus)
  if matrix.shape[1]<3:return []
  model=LatentDirichletAllocation(n_components=min(5,max(2,len(corpus)//2)),random_state=17,max_iter=8,learning_method='batch')
  weights=model.fit_transform(matrix); names=vec.get_feature_names_out(); result=[]
  for i,component in enumerate(model.components_):
   top=component.argsort()[-6:][::-1]; result.append({'name':' · '.join(names[j] for j in top[:3]),'terms':[names[j] for j in top],'documents':int(sum(weights[:,i]>.2))})
  return result
 except (ImportError, ValueError):return []

_embedder=None
def embedding_scores(query, passages):
 """Use a configured local sentence-transformer; return None if unavailable."""
 global _embedder
 model_name=os.environ.get('RESEARCH_EMBEDDING_MODEL','').strip()
 if not model_name:return None
 try:
  if _embedder is None:
   from sentence_transformers import SentenceTransformer
   _embedder=SentenceTransformer(model_name)
  from sentence_transformers.util import cos_sim
  vectors=_embedder.encode([query]+passages,normalize_embeddings=True,show_progress_bar=False)
  return cos_sim(vectors[0],vectors[1:]).cpu().tolist()[0]
 except Exception as exc:
  print('Embedding model unavailable; using TF-IDF fallback:',exc,file=sys.stderr)
  return None

def ranked_passages(question, docs):
 candidates=[]
 for r in docs:
  seen=set()
  for s in sentences(r['text']):
   if s not in seen:
    seen.add(s); candidates.append((r,s))
 if not candidates:return []
 try:
  scores=embedding_scores(question,[s for _,s in candidates])
  if scores is None:
   from sklearn.feature_extraction.text import TfidfVectorizer
   from sklearn.metrics.pairwise import cosine_similarity
   vec=TfidfVectorizer(stop_words='english',ngram_range=(1,2)); mat=vec.fit_transform([question]+[s for _,s in candidates]); scores=cosine_similarity(mat[0:1],mat[1:]).ravel()
 except (ImportError,ValueError):
  qt=terms(question); scores=[len(qt&terms(s))/max(1,len(qt)) for _,s in candidates]
 ranked=[]
 for (r,s),score in zip(candidates,scores):
  if score>0:ranked.append({'title':r['title'],'text':s,'page':page_for(r['text'],s),'score':float(score)})
 return sorted(ranked,key=lambda x:x['score'],reverse=True)[:6]

def page_for(text, sentence):
 # PDF page separators are inserted during extraction; otherwise estimate from page breaks.
 if '\f' not in text:return None
 pos=text.find(sentence)
 if pos<0:return None
 return text[:pos].count('\f')+1

def pdf_text(path):
 try:
  from pypdf import PdfReader
  reader=PdfReader(str(path)); return '\n\f\n'.join((p.extract_text() or '') for p in reader.pages),len(reader.pages)
 except ImportError: raise RuntimeError('PDF processing dependency is missing. Install requirements.txt and restart.')
 except Exception as e: raise RuntimeError('Could not read this PDF: '+str(e))

def words(s): return set(re.findall(r'[a-zA-Z][a-zA-Z0-9-]{2,}',s.lower()))
STOP=set('the and for with that this from into were have been about which their there these those using used based study paper research results data method methods model approach'.split())
def terms(s): return words(s)-STOP
def similarity(a,b):
 x,y=terms(a),terms(b)
 return len(x&y)/max(1,len(x|y))

class App(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT),**kw)
 def send_json(self,obj,status=200):
  raw=json.dumps(obj).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
 def do_GET(self):
  try:return self._do_GET()
  except Exception as exc:
   print(f'GET {self.path} failed: {exc!r}',file=sys.stderr)
   return self.send_json({'error':'The server could not complete this request. Check the backend terminal for details.'},500)
 def _do_GET(self):
  if self.path=='/api/papers':
   c=db(); rows=c.execute('SELECT id,title,filename,created,text FROM papers ORDER BY created DESC').fetchall(); out=[]
   for r in rows:
    claims,ents=analyze(r['text']); out.append({'id':r['id'],'title':r['title'],'filename':r['filename'],'created':r['created'],'chars':len(r['text']),'claims':claims,'entities':ents,'sections':section_index(r['text']),'excerpt':r['text'][:2500]})
   c.close(); return self.send_json(out)
  if self.path=='/api/topics':
   c=db(); texts=[r['text'] for r in c.execute('SELECT text FROM papers')]; c.close(); return self.send_json(topic_model(texts))
  if self.path=='/api/health': return self.send_json({'ok':True,'pdf':'pypdf' in sys.modules or self.pdf_available()})
  return super().do_GET()
 @staticmethod
 def pdf_available():
  try: import pypdf; return True
  except: return False
 def do_POST(self):
  try:return self._do_POST()
  except Exception as exc:
   print(f'POST {self.path} failed: {exc!r}',file=sys.stderr)
   return self.send_json({'error':'The server could not complete this request. Check the backend terminal for details.'},500)
 def _do_POST(self):
  if self.path=='/api/upload':
   path=None; c=None
   try:
    n=int(self.headers.get('Content-Length','0'))
    if n<=0:return self.send_json({'error':'Upload request is empty.'},400)
    if n > MAX_UPLOAD_BYTES * 4 // 3 + 100_000:return self.send_json({'error':'File is too large. Maximum upload size is 50 MB.'},413)
    body=json.loads(self.rfile.read(n))
    if not isinstance(body,dict):return self.send_json({'error':'Upload request must be a JSON object.'},400)
    name=Path(str(body.get('name','paper.pdf'))).name
    suffix=Path(name).suffix.lower()
    if suffix not in {'.pdf','.txt','.md'}:return self.send_json({'error':'Upload a PDF, TXT, or Markdown file.'},415)
    encoded=body.get('data','')
    if not isinstance(encoded,str) or not encoded:return self.send_json({'error':'The uploaded file data is missing.'},400)
    if len(encoded) > MAX_UPLOAD_BYTES * 4 // 3 + 8:return self.send_json({'error':'File is too large. Maximum upload size is 50 MB.'},413)
    raw=base64.b64decode(encoded,validate=True)
    if not raw:return self.send_json({'error':'The uploaded file is empty.'},400)
    if len(raw)>MAX_UPLOAD_BYTES:return self.send_json({'error':'File is too large. Maximum upload size is 50 MB.'},413)
    sha=hashlib.sha256(raw).hexdigest(); c=db()
    old=c.execute('SELECT id FROM papers WHERE sha=?',(sha,)).fetchone()
    if old: c.close(); return self.send_json({'error':'This exact file is already in your library.'},409)
    fid=str(uuid.uuid4()); path=UPLOADS/(fid+'_'+name); path.write_bytes(raw)
    if suffix=='.pdf': text,pages=pdf_text(path)
    else: text=raw.decode('utf-8',errors='replace'); pages=0
    if len(text.strip())<100: path.unlink(missing_ok=True); c.close(); return self.send_json({'error':'No readable text found. Scanned PDFs need OCR first; this file may be image-only.'},422)
    title=Path(name).stem.replace('_',' ').replace('-',' ')
    c.execute('INSERT INTO papers(id,title,filename,sha,text) VALUES(?,?,?,?,?)',(fid,title,name,sha,text)); c.commit(); c.close()
    return self.send_json({'id':fid,'title':title,'pages':pages,'chars':len(text)})
   except (json.JSONDecodeError, UnicodeDecodeError, ValueError, binascii.Error) as e:
    if path: path.unlink(missing_ok=True)
    if c: c.close()
    return self.send_json({'error':'Invalid upload data: '+str(e)},400)
   except RuntimeError as e:
    if path: path.unlink(missing_ok=True)
    if c: c.close()
    status=500 if 'dependency is missing' in str(e).lower() else 422
    return self.send_json({'error':str(e)},status)
   except Exception as e:
    if path: path.unlink(missing_ok=True)
    if c: c.close()
    print('Upload failed:',repr(e),file=sys.stderr)
    return self.send_json({'error':'The server could not process this upload. Check the backend terminal for details.'},500)
  if self.path=='/api/ask':
   n=int(self.headers.get('Content-Length','0')); q=json.loads(self.rfile.read(n)).get('question','').strip()
   c=db(); rows=c.execute('SELECT id,title,text FROM papers').fetchall(); c.close()
   if not q:return self.send_json({'answer':'Enter a question to search the uploaded papers.','citations':[]})
   hits=ranked_passages(q,rows)
   if not hits or hits[0]['score']<.08:return self.send_json({'answer':'The uploaded papers do not provide enough evidence to answer this question.','citations':[]})
   return self.send_json({'answer':'Here are the most relevant passages found in your uploaded papers. The answer is limited to this document set.','citations':hits})
  if self.path=='/api/delete':
   n=int(self.headers.get('Content-Length','0')); fid=json.loads(self.rfile.read(n)).get('id'); c=db(); row=c.execute('SELECT filename FROM papers WHERE id=?',(fid,)).fetchone()
   if not row:c.close(); return self.send_json({'error':'Paper not found'},404)
   c.execute('DELETE FROM papers WHERE id=?',(fid,)); c.commit(); c.close()
   for f in UPLOADS.glob(fid+'_*'): f.unlink(missing_ok=True)
   return self.send_json({'deleted':True})
  self.send_error(404)
 def log_message(self, fmt, *args):
  # Keep request logs visible in the terminal so proxy and route failures are diagnosable.
  sys.stderr.write('[paper-api] ' + (fmt % args) + '\n')

if __name__=='__main__':
 host=os.environ.get('RESEARCH_API_HOST','127.0.0.1')
 port=int(os.environ.get('RESEARCH_API_PORT','8000'))
 try:
  server=ThreadingHTTPServer((host,port),App)
 except OSError as exc:
  print(f'Could not start Research Paper Intelligence on {host}:{port}: {exc}',file=sys.stderr)
  print('Check whether another process is using this port, then restart the server.',file=sys.stderr)
  raise SystemExit(1)
 print(f'Research Paper Intelligence running at http://{host}:{port}',flush=True)
 print(f'Health check: http://127.0.0.1:{port}/api/health',flush=True)
 try:
  server.serve_forever()
 except KeyboardInterrupt:
  print('\nStopping Research Paper Intelligence...',flush=True)
 finally:
  server.server_close()
