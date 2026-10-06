import json, sys, os
path = "spike/data/labels.json"
labels = json.load(open(path)) if os.path.exists(path) else {}
run, image, *items = sys.argv[1:]
for it in items:
    idx, rest = it.split(":", 1)
    parts = rest.split(",", 6)
    contains, exists, findable, interesting, clue, safe = parts[:6]
    note = parts[6] if len(parts) > 6 else None
    l = {
        "contains": {"y": "yes", "p": "partial", "n": "no"}[contains],
        "findable": findable == "y",
        "interesting": int(interesting),
        "clue": int(clue),
        "safe": safe == "y",
    }
    if exists in ("y", "n"):
        l["exists"] = exists == "y"
    if note:
        l["note"] = note
    labels[f"{run}/{image}#{idx}"] = l
json.dump(labels, open(path, "w"), indent=1, sort_keys=True)
print(len(labels), "labels")
