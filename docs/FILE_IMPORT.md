# File import (Phase 3b)

Teachers can upload their own files and turn them into questions or a quiz. Two paths, both ending in the normal question bank
(so every existing rule about review, approval, versions and tenant isolation still applies):

| Path | When | AI involved? |
|---|---|---|
| **A. Structured import** | the file already holds a table of questions (e.g. a Wayground/Quizizz export, or any sheet/CSV with similar headings) | **No.** Rows are parsed deterministically and validated with the same schema as manual entry |
| **B. AI from text** | notes, slides, a Word file, a PDF… | Yes, through the existing AI Question Studio. The teacher picks which parts of the file to use; the server reads that text (the browser only names the parts) |

## What can be read

Detection is by **content**, never by file name or the browser's claimed type.

| Kind | How | Notes |
|---|---|---|
| `.xlsx` | own reader (`fflate` + linear string scan), shared strings, inline strings, booleans, numbers | one text section per sheet; question tables detected on any sheet. Formulas show their last saved value; dates are not interpreted |
| `.csv` / `.tsv` | own parser (quotes, embedded newlines, BOM, delimiter sniffed) | UTF-8 first, Windows-1252 fallback |
| `.docx` | paragraphs from `word/document.xml` | a new section starts at each heading. Tables are read as text; images ignored |
| `.pptx` | text boxes per slide | one section per slide, numeric order. Notes and pictures ignored |
| `.pdf` | `unpdf` text layer, max 150 pages | **quality gate**: if the text layer is garbage (control characters, broken font maps) it is treated as unreadable and sent to OCR |
| `.png` / `.jpg` | OCR | header dimensions checked first (max 16 megapixels) |
| `.txt` / `.md` | text; Markdown headings start sections | binary data (NUL bytes) is refused |
| legacy `.doc/.xls/.ppt` | **refused** with advice to Save As the newer type | |

**OCR** needs the `tesseract` and `pdftoppm` programs on the server (both are present in the dev container). The server checks
once whether they exist; `GET /institutions/:id/uploads/capabilities` tells the UI. With OCR off or missing, scans and pictures are refused with a clear message instead of failing silently.
OCR runs with argument arrays (no shell), in a private temp directory removed afterwards, with a 60 s limit, at most 2 jobs at a time and at most 15 pages per PDF. OCR text is flagged and the UI warns the teacher to check it.

## Question-table layout (Path A)

The header row is looked for in the first 15 rows of every sheet. Recognised headings (case/punctuation ignored):

| Field | Headings |
|---|---|
| question | Question Text, Question, Questions, Stem, Prompt |
| type | Question Type, Type |
| options | Option 1–6, Choice 1–6, Answer 1–6, Option A–F, or bare A–F |
| correct answer | Correct Answer, Correct, Answer, Key, Right Answer |
| explanation | Answer explanation, Explanation, Rationale, Feedback, Solution |
| marks · difficulty · time | Marks/Points/Score · Difficulty · Time in seconds/Time |
| image | Image Link (ignored, with a note) |

Correct answers may be a **position** (`2` means "Option 2" even if an earlier option cell is blank), a letter, or the option's text.
Types: Multiple Choice → MCQ, True/False, Fill in the Blank / Short Answer (options are the accepted answers).
**Flagged, never guessed:** open-ended/essay (no marking guide), checkbox/multi-answer (not supported yet), polls, unknown types, an
answer that points at nothing, duplicate wording inside the file. Up to 500 rows per file. Flagged rows cannot be imported; the preview says why.

## Import rules

- Nothing is saved until the teacher presses Import; the preview shows every row and what will happen to it.
- Imported questions get `source = 'import'`, link back to the upload, start at version 1, and are `needs_review` unless the teacher holds `questions.review` **and** ticks "approve".
- Questions already in the bank for that subject (same wording after normalising) are skipped and reported, so importing twice does nothing.
- "Also make a quiz" needs approval and `quizzes.manage`. It is created in the same database transaction (all or nothing). Time per question defaults to the **median of the file's time column** (clamped 5–300 s), overridable.
- Up to 100 questions per quiz (existing quiz limit).

## What is stored

Only the extracted text sections and parsed question table (and a SHA-256 of the file for duplicate detection), **not the original file**. Uploading the identical file again in the same school returns the existing record. Deleting an upload deletes the text; questions already imported stay.

Uploading requires ticking "I wrote this material or have permission to use it". The confirmation time is stored and audited (`upload.create`). This is a record of the teacher's statement, **not a copyright check**; the platform cannot verify it.

## Limits and safety

| Limit | Value |
|---|---|
| file size | 5 MB (`MAX_UPLOAD_BYTES`), one file per request |
| uploads | 20/min per user (`UPLOAD_RATE_LIMIT_PER_MIN`) |
| decompressed size of an Office file | 25 MB per part, 60 MB in total, max 2,000 parts (zip-bomb guard) |
| sheets / rows / columns | 20 / 5,000 / 60 |
| extracted text per file | 400,000 characters, 200 sections of about 5,000 |
| text sent to AI per request | 12,000 characters, **refused (not silently cut)** if the selection is larger |

- No XML parser is used, so there are no entity-expansion or external-reference attacks. Every scan is `indexOf`-based and linear; a test feeds malformed XML designed to make backtracking parsers crawl and requires it to finish quickly.
- Text in a file is **untrusted data**: AI grounding text is fenced and the AI is told never to follow instructions inside it; output still lands in review.
- The AI route only reads uploads that belong to the caller's school, and re-checks that every chosen section exists.
- Uploads are teacher/admin-only (`questions.write`), tenant-isolated with the same non-disclosure rule as questions, and audited (`upload.create`, `upload.import`, `upload.delete`; failures are audited without the file name).

## Not built

- AI "extract the questions that are already in this document" (a faithful-extraction mode). Today a PDF/Word file can only be used as grounding text for **new** AI questions.
- Multi-answer and open-ended question import; images inside questions or files; tables inside Word/PDF as structure; formulas are not evaluated.
- Legacy Office formats, password-protected files, and archives.
- Importing third-party material is the teacher's responsibility; no copyright detection exists.
