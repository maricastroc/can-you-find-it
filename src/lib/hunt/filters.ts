import type { Box } from "./geometry";

const MASS = new Set([
  "foliage", "leaves", "leaf", "grass", "lawn", "sky", "water", "tree", "trees", "canopy", "bushes", "bush",
  "shrub", "shrubs", "hedge", "path", "pathway", "pavement", "walkway", "ground", "facade", "façade",
  "building", "buildings", "wall", "mass", "area", "forest", "woods", "clouds", "river", "lake", "sea",
  "street", "road", "square", "plaza", "park", "vegetation", "greenery", "ferns", "undergrowth", "weeds", "moss",
  "bridge", "skyline", "hillside", "slope", "field", "meadow", "lawn",
]);
const QUANTIFIER = /^(?:a |an |the )?(?:(?:small|large|big|dense|thick|bright|dark|several|many|tall|low|tiny|huge),?\s+)*(?:patch|patches|area|areas|mass|masses|cluster|clusters|group|groups|row|rows|pile|piles|line|lines|stretch|expanse|section|sections) of /i;
const GENERIC = new Set(["structure", "formation", "feature", "element", "detail", "part", "piece", "section", "thing", "object"]);
const CUT = /\s(?:with|on|near|in|at|atop|beside|behind|under|underneath|beneath|below|above|along|by|against|that|which|from|between|over|across|next|of|inside|outside|around|through|into|onto|upon|within|for|to|among|covering|standing|supporting|leading|attached|mounted|growing|hanging|sitting|flanking|displaying|spanning|visible|set|placed|leaning|lining|framing|marking|showing)\s/i;

const ING_NOUNS = new Set([
  "railing", "painting", "drawing", "carving", "building", "ceiling", "swing", "ring", "string", "spring", "wing", "thing",
  "opening", "awning", "fencing", "lettering", "writing", "marking", "markings", "clothing", "sapling", "seating", "planting",
  "landing", "crossing", "parking", "ending", "covering", "lighting", "sign",
]);

const LOCATION =
  /\s(?:near|beside|behind|next to|by the|in front of|across from|opposite|close to|alongside|underneath|beneath|below|above|left of|right of|at the (?:base|foot|edge|top|end) of|on the (?:left|right|far|other)|in the (?:background|foreground|distance|middle|corner))\b/i;

export function withoutLocation(label: string): string {
  const m = label.match(LOCATION);
  return m && m.index ? label.slice(0, m.index) : label;
}

export function headNoun(label: string): string {
  const phrase = label.trim().replace(QUANTIFIER, "");
  const core = phrase.split(CUT)[0] ?? phrase;
  let words = core.toLowerCase().replace(/[^a-zà-ÿ\s-]/g, " ").split(/\s+/).filter(Boolean);
  const participle = words.findIndex((w, i) => i > 0 && w.endsWith("ing") && !ING_NOUNS.has(w));
  if (participle > 0) words = words.slice(0, participle);
  const last = words.at(-1) ?? "";
  return GENERIC.has(last) && words.length > 1 ? words.at(-2)! : last;
}

export type Rejection = "mass_noun" | "too_large" | "person" | "animal" | "vehicle";

const PERSON = /\b(person|people|man|woman|child|children|kid|kids|boy|girl|pedestrian|cyclist|couple|tourist|crowd|face|license plate)\b/i;

const ANIMAL = /\b(duck|ducks|duckling|bird|birds|pigeon|pigeons|gull|seagull|swan|goose|geese|dog|dogs|puppy|cat|cats|kitten|squirrel|horse|cow|sheep|goat|chicken|hen|rooster|deer|fox|rabbit|insect|butterfly|bee|fish)\b/i;
const VEHICLE = /\b(car|cars|van|truck|lorry|bus|taxi|cab|vehicle|hatchback|sedan|saloon|suv|minivan|pickup|motorbike|motorcycle|moped|scooter|boat|bicycle|bike|tram)\b/i;

export function rejectTarget(label: string, box: Box): Rejection | undefined {
  if (PERSON.test(label)) return "person";
  if (!/\b(rack|house|box|stop|sign|feeder|bath|statue|sculpture|figure|figurine|plinth|carving|relief|mural|painting|drawing|stencil|sticker|toy|weathervane|fountain|stand|shelter|lane|bowl)\b/i.test(label)) {
    if (ANIMAL.test(label)) return "animal";
    if (VEHICLE.test(label)) return "vehicle";
  }
  if (MASS.has(headNoun(label))) return "mass_noun";
  if (box.w * box.h > 0.15) return "too_large";
  return undefined;
}
