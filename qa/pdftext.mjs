// Dev-only: dump a PDF's text, one line per page.  node qa/pdftext.mjs <file>
import * as mupdf from 'mupdf';
import { readFileSync } from 'node:fs';
const d = mupdf.Document.openDocument(readFileSync(process.argv[2]), 'application/pdf');
for (let i = 0; i < d.countPages(); i++) console.log(`[p${i + 1}] ` + d.loadPage(i).toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' '));
