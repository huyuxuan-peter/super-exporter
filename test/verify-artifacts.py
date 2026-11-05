"""Read exported files with independent, cross-platform document/image readers."""
import json
import sys


def verify(kind, paths):
    if kind == "docx":
        from docx import Document

        document = Document(paths[0])
        return {"tables": len(document.tables), "images": len(document.inline_shapes),
                "text": "\n".join(p.text for p in document.paragraphs)}
    if kind == "pdf":
        from pypdf import PdfReader

        document = PdfReader(paths[0])
        links = []
        for page in document.pages:
            for annotation in page.get("/Annots", []):
                action = annotation.get_object().get("/A", {})
                if hasattr(action, "get_object"):
                    action = action.get_object()
                if action.get("/URI"):
                    links.append(str(action["/URI"]))
        return {"pages": len(document.pages), "width": float(document.pages[0].mediabox.width),
                "height": float(document.pages[0].mediabox.height), "links": links,
                "text": "\n".join(page.extract_text() or "" for page in document.pages)}
    if kind == "png":
        from PIL import Image

        frames = [Image.open(path).convert("RGB") for path in paths]
        return {"frames": [{"width": frame.width, "height": frame.height,
                            "colors": len(frame.getcolors(frame.width * frame.height)),
                            "corner": list(frame.getpixel((0, 0)))} for frame in frames],
                "tailMarker": any(color == (255, 2, 191) for _, color in
                                  frames[-1].getcolors(frames[-1].width * frames[-1].height))}
    raise ValueError("Unknown artifact kind: " + kind)


print(json.dumps(verify(sys.argv[1], sys.argv[2:]), ensure_ascii=True))
