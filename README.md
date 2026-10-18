# Papertrail Research

A local-first research paper intelligence application. The interface uses a warm brown and off-white palette and has no testimonials, customer counters, AI-generated imagery, cursor effects, or scroll animations.

## Run locally

Install the frontend and backend dependencies, then build the React UI:

```powershell
npm install
npm run build
python -m pip install --target vendor -r requirements.txt
python server.py
```

Open `http://127.0.0.1:8000`. The build writes the React page and its bundled assets into the project root, where the Python server serves the interface and its `/api` endpoints.

For frontend development with hot reload, use two PowerShell terminals from this project folder. In the first, activate the same Python environment where the requirements are installed and run `python server.py`. Keep that terminal open; it prints the bound address, health-check URL, and each API request. In the second, run `npm run dev` and open `http://127.0.0.1:5173`. Vite proxies `/api` requests to `http://127.0.0.1:8000` by default. To use another backend address, set `$env:RESEARCH_API_URL = 'http://127.0.0.1:8001'` before `npm run dev`, and set `$env:RESEARCH_API_PORT = '8001'` before `python server.py`.

Check the backend directly at `http://127.0.0.1:8000/api/health`; it should return JSON with `"ok": true`. Then check `http://127.0.0.1:8000/api/papers`; an empty library should return `[]`. If the browser says the site took too long to respond, the Python process is not listening on port 8000 or has exited. If startup says the port is already in use, stop the old Python server process or choose a different port for both processes. The frontend proxy prints connection errors in the Vite terminal.

Uploaded documents and the SQLite index are stored in `data/`. The app binds to localhost. Delete a paper from the library or stop the server and remove `data/` to clear all stored files. If package installation is unavailable, dependencies can be installed into a local `vendor/` directory; the server adds it to the Python import path automatically.

## Features

- Upload multiple text-selectable PDFs, `.txt`, and `.md` documents up to 50 MB each. Duplicate files are detected by SHA-256.
- Extract PDF page text with `pypdf`, preserving page boundaries for citations. Image-only scans are reported as unreadable; run OCR separately before importing.
- Heuristic, transparent evidence extraction for research objectives, methods, datasets, experimental setup, results, and limitations. Every detected claim includes its supporting sentence, PDF page when available, and a heuristic confidence score. Plain-text uploads do not receive fabricated page numbers. Missing fields are marked “Not found.”
- Best-effort section heading detection and passage counts. Section headings are shown only when detected in the source text.
- Dictionary-based entity recognition for common methods/models, datasets, metrics, and research tasks.
- Side-by-side comparison of up to four papers, recurring-entity counts, limitation pattern suggestions, and a document-grounded passage search with source paper and page citations.
- Corpus topic modeling with LDA (for at least three substantial papers) and TF-IDF cosine retrieval. Optional sentence-transformer embeddings can improve semantic passage retrieval.
- Delete removes the uploaded original and database record.
- Privacy and Terms pages and an original SVG favicon are included.

## Architecture

```text
server.py                Local HTTP API, document-processing backend, and static React build server
src/main.jsx             React interface, upload flow, library, comparison,
                         topic and gap views, and document Q&A
src/styles.css           Responsive brown-and-white design system
src/index.html            Vite React entry page
vite.config.js            Development proxy (configurable API target) and static production build setup
index.html / assets/      Generated files served by the existing Python server
privacy.html             Local-first privacy details and deployment notes
terms.html               Research-use terms and limitations
data/papers/             Original uploaded documents (created at runtime)
data/research.db         Extracted text and document metadata (created at runtime)
```

## NLP approach and known limitations

The app intentionally runs without external model APIs or credentials. Extraction uses keyword-triggered sentence selection and entity dictionaries. Topic discovery uses scikit-learn LDA. Passage retrieval uses TF-IDF cosine similarity by default and returns matching source passages rather than generated answers. To enable neural semantic retrieval, install `requirements-embeddings.txt` into `vendor` and set `RESEARCH_EMBEDDING_MODEL` to a local sentence-transformer model directory before starting the server (a model identifier may download weights on first use, so a local path is preferred for offline/privacy-sensitive deployments). The configured model improves paraphrase matching; it is not required for the main application. Extraction can still miss unfamiliar terminology. Confidence is a heuristic ranking, not calibrated probability. Page citations refer to extracted PDF page boundaries; plain text files have no page numbers.

## Demo workflow

1. Add two or more selectable-text research papers.
2. Open Paper library to inspect claims, entities, and source passages.
3. In Compare papers, select at least two papers and compare extracted evidence.
4. In Themes & gaps, inspect repeated entities and limitation passages, then verify the cited source passages.
5. In Ask your papers, search for a question and inspect each matched paper/page excerpt.
6. Delete an uploaded paper to remove its original and extracted record.

For a real-paper walkthrough, download the PDF versions of [Attention Is All You Need](https://arxiv.org/abs/1706.03762) and [BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding](https://arxiv.org/abs/1810.04805) from their arXiv pages, then add both PDFs to the library. The papers remain user-supplied files; the app does not bundle or fabricate sample research results.

## Launch readiness

This local application is not deployed. A custom domain cannot be connected without a domain name and hosting/DNS access. Before a public launch, configure the domain and HTTPS, replace the generic legal contact/deployment notes with reviewed organization-specific policies, review access control and storage security for the hosting model, and check the host's branding/footer requirements. The interface does not include a “Made with AI” tag.
