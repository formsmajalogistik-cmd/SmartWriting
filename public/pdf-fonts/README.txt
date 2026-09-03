Adobe Core-14 font metrics (AFM) for the book PDF export.

These four files describe the metrics of the standard PDF font family "Times",
which every PDF reader supplies itself. Shipping the metrics lets the export
typeset a serif book WITHOUT embedding a font file — the PDFs stay small and
no font licence travels with them.

Files: Times-Roman.afm, Times-Bold.afm, Times-Italic.afm, Times-BoldItalic.afm
Origin: the pdfkit package (MIT), which distributes Adobe's freely available
core font metrics. Copyright (c) 1985–1997 Adobe Systems Incorporated.

They are fetched on demand by src/lib/export/pdf.js on the first book export
(never at app start-up) and handed to pdfmake as a virtual file system.
