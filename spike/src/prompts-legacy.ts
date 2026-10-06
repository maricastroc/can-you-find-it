/**
 * Prompts from earlier spike iterations (v1–v3, yes/no verifier, free-form
 * writer, v1 compare). Kept so old runs stay reproducible; the product uses
 * src/lib/hunt/prompts.ts.
 */
export * from "../../src/lib/hunt/prompts";

export const LENSES = [
  "purpose",
  "nature_reclaiming",
  "human_trace",
  "repaired",
  "out_of_place",
  "hidden_in_plain_sight",
  "shape_or_color",
] as const;

export const SYSTEM = `You are the eye of "Can You Find It?", a real-world game.
A person is standing in a public place and took one wide photo of what is in front of them.
You secretly pick something in the photo. They put the phone away and must find it with their own eyes, by walking around and looking.

How to pick a target:
- Only pick objects you can see with certainty in this photo. Never invent or assume details you cannot clearly see.
- Pick ONE specific, distinctive object you could point at with a finger: a sign, a plaque, a number, a lamp, a sculpture, a bench, a bin, a gate, a drain cover, a mailbox, a planter, a bike rack, a poster, a flag, a clock, something attached to a pole or a wall...
- It must be unique in the scene. If there are several identical ones, pick the one that is different, or pick something else.
- Never pick an area or a mass: trees, foliage, leaves, grass, sky, water, a whole building, a whole wall, a row of windows, the path, the ground.
- It must be reachable on foot and recognisable when standing near it. Not tiny and far away.
- Avoid the biggest, most obvious object of the scene.
- Safety and respect: never a person, never an animal, never faces, license plates or the inside of homes. Nothing that requires crossing traffic, entering private property, climbing or touching.

The magic is in the clue, not in exotic objects. An ordinary lamp post becomes interesting with "It only does its job after dark." A house number becomes "It tells the postman where to stop."
Lenses for the clue (use one only if it is true for what you can see):
- purpose: what it is for, told sideways
- nature_reclaiming: something nature is taking back (moss, a plant in a crack, rust)
- human_trace: evidence someone was here before (a sticker, a lock, worn paint, a forgotten object)
- repaired: something somebody fixed or patched instead of replacing
- out_of_place: something that does not quite belong here
- hidden_in_plain_sight: a small fixture nobody looks at
- shape_or_color: an unusual color, shape, pattern or texture

Writing rules for each target:
- label: what the object is and what makes it unique, in 4-12 words. Describe only its appearance, never its position in the photo (no "left", "right", "background", "foreground"). Example: "black iron lamp post with a glass lantern on top".
- clue: the opening line of the game, at most 12 words. A plain, intriguing statement about the object's story, purpose or state that makes the player look around. Never name the object, its color or where it is. No flowery words (whisper, sentinel, silent, ancient, testament, embrace, tapestry, journey). Good clues: "Someone tried to fix it instead of replacing it." "It only does its job after dark." "It tells you where you are, if you know how to read it." "Nobody sits here anymore."
- hint_semantic: a more helpful hint about what it is for or what it means. Still do not name it.
- hint_concrete: a concrete visual hint: material, color, shape, size, height above the ground.
- reveal: one short sentence for after it is found, an interesting thought about it.`;

const BOX_RULE = `box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 grid relative to the image and must tightly enclose only the target.`;

const INVENTORY_RULE = `First, in "seen", list 12 specific, concrete objects you can clearly see (2-6 words each, appearance only). Then choose the targets only from that list.`;

export const SINGLE_PROMPT = (n: number, inventory = false) =>
  `${inventory ? INVENTORY_RULE + " " : ""}Pick ${n} different targets in this photo, spread across the scene. ${BOX_RULE}`;

export const PROPOSE_PROMPT = (n: number, inventory = false) =>
  `${inventory ? INVENTORY_RULE + " " : ""}Pick ${n} different targets in this photo, spread across the scene. In "locator", say exactly where it is in the photo (for example "right edge, at the base of the second tree").`;

export const GROUND_PROMPT = (label: string, locator: string) =>
  `Detect the ${label} (${locator}). There is exactly one. Output only \`\`\`json with box_2d and label.`;

export const TILE_PROMPT = (n: number) =>
  `This image is one part of a wider photo. Pick ${n} target${n > 1 ? "s" : ""} in this part. ${BOX_RULE}`;

export const VERIFY_PROMPT = (label: string) =>
  `Look only at this image. First describe in a few words the main thing near the center. Then say whether this is clearly visible anywhere in the image: "${label}". Be strict about the distinctive details: if they are not visible, answer false.`;

export const WRITER_SYSTEM = `You write the texts for "Can You Find It?", a real-world game.
A player is standing in a public place. A secret target was chosen in the scene. The player will put the phone away and look for it with their own eyes.
You get a close-up of the target and a small view of the whole scene. Write about what the close-up really shows: the details a person will notice when they get near it.

Rules:
- clue: the opening line, at most 12 words. A plain, intriguing statement about the target's story, purpose or state that makes the player look around and think. Never name the object, its color or where it is. It must not fit most other objects in the scene. No flowery words (whisper, sentinel, silent, ancient, testament, embrace, tapestry, journey, gloom, banish).
- hint_semantic: a more helpful hint about what it is for or what it means. Still do not name it.
- hint_concrete: a concrete visual hint: material, color, shape, size, height above the ground.
- reveal: one short sentence for after it is found: a thoughtful or surprising observation about this exact object, based only on what is visible. No invented history or facts.
- lens: the angle of the clue.
- difficulty: how hard it will be to find in this scene.`;

export const WRITER_PROMPT = (label: string) =>
  `Image 1: close-up of the secret target ("${label}"). Image 2: the whole scene. Write the game texts for this target.`;

export const writerSchema = {
  type: "object",
  properties: {
    what_is_special: { type: "string" },
    lens: { type: "string", enum: [...LENSES] },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    clue: { type: "string" },
    hint_semantic: { type: "string" },
    hint_concrete: { type: "string" },
    reveal: { type: "string" },
  },
  required: ["what_is_special", "lens", "difficulty", "clue", "hint_semantic", "hint_concrete", "reveal"],
};

export const COMPARE_PROMPT = (label: string) =>
  `Image 1 is a crop from a wide photo showing a hidden target: "${label}".
Image 2 is a close-up photo a player just took while searching for it in the real place.
Does image 2 show the same target (it may be from a different distance, angle or light)? A different object of the same kind does not count if the distinctive details differ.`;

// ---- Ollama structured-output schemas -------------------------------------

const box2d = { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 };
const common = {
  lens: { type: "string", enum: [...LENSES] },
  why: { type: "string" },
  difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
  clue: { type: "string" },
  hint_semantic: { type: "string" },
  hint_concrete: { type: "string" },
  reveal: { type: "string" },
};
const commonKeys = Object.keys(common);

export const targetsSchema = (n: number, opts: { box: boolean; locator?: boolean; inventory?: boolean }) => ({
  type: "object",
  properties: {
    ...(opts.inventory ? { seen: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 15 } } : {}),
    targets: {
      type: "array",
      minItems: n,
      maxItems: n,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          ...(opts.locator ? { locator: { type: "string" } } : {}),
          ...(opts.box ? { box_2d: box2d } : {}),
          ...common,
        },
        required: ["label", ...(opts.locator ? ["locator"] : []), ...(opts.box ? ["box_2d"] : []), ...commonKeys],
      },
    },
  },
  required: [...(opts.inventory ? ["seen"] : []), "targets"],
});

export const verifySchema = {
  type: "object",
  properties: { what_i_see: { type: "string" }, visible: { type: "boolean" } },
  required: ["what_i_see", "visible"],
};

export const compareSchema = {
  type: "object",
  properties: {
    image2_shows: { type: "string" },
    same_target: { type: "boolean" },
    confidence: { type: "number" },
  },
  required: ["image2_shows", "same_target", "confidence"],
};
