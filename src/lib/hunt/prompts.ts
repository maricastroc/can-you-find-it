import { withoutLocation } from "./filters";

export const MCQ_PROMPT = (options: string[]) =>
  `Look only at this image. Which ONE of these is clearly visible near the center of the image? If none of them is clearly visible, answer "none".
${options.map((o) => `- ${o}`).join("\n")}
First say in a few words what is near the center. Then copy the matching option exactly. Finally say whether a person is on it, at it or touching it (sitting on it, leaning on it, standing right in front of it). People further away do not count.`;

export const mcqSchema = (options: string[]) => ({
  type: "object",
  properties: {
    what_i_see: { type: "string" },
    answer: { type: "string", enum: [...options, "none"] },
    person_at_target: { type: "boolean" },
  },
  required: ["what_i_see", "answer", "person_at_target"],
});

export const GENERIC_DISTRACTORS = [
  "a red fire hydrant",
  "a bicycle leaning on a post",
  "a blue recycling bin",
  "a bronze statue of a horse",
  "a yellow taxi",
  "a wooden birdhouse",
];

export const COMPARE2_PROMPT = (label: string) =>
  `Image 1 is a crop from a wide photo showing a hidden target: "${label}".
Image 2 is a close-up photo a player just took while searching for it in the real place.
First list up to 3 distinctive visual details of the target object itself (shape, color, text, marks, attachments), not of its background.
Then say what the main object in image 2 is.
same_kind: is the main object in image 2 the same kind of object as the target (for example both benches, or both lamp posts)? What surrounds it does not count.
same_object: is it the very same object? It may be seen from another distance, angle or light, but its distinctive details must match. A different object of the same kind is not the same object.`;

export const compare2Schema = {
  type: "object",
  properties: {
    target_details: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
    image2_shows: { type: "string" },
    same_kind: { type: "boolean" },
    same_object: { type: "boolean" },
  },
  required: ["target_details", "image2_shows", "same_kind", "same_object"],
};

export const LENS_MENU = [
  { id: "where_you_are", line: "It tells you where you are, if you know how to read it.", when: "street-name signs, house numbers, maps, name plaques" },
  { id: "read_me", line: "It has something to tell you, if you get close enough to read it.", when: "small signs, labels, notices and plaques with text" },
  { id: "after_dark", line: "It only does its job after dark.", when: "lamps and lights" },
  { id: "remember", line: "Someone wanted this place to remember something.", when: "memorials, commemorative plaques, monuments, statues, dated inscriptions" },
  { id: "who_gets_in", line: "It decides who gets in.", when: "gates, barriers, turnstiles" },
  { id: "waiting", line: "It spends its days waiting for someone.", when: "benches, seats, bus stops, mailboxes" },
  { id: "keeps_time", line: "Everyone here trusts it to keep time.", when: "clocks, sundials" },
  { id: "cared_for", line: "Somebody takes care of this, every single week.", when: "planters, flower pots, hanging baskets, tended flower beds" },
  { id: "nature_taking_back", line: "I found something nature is taking back.", when: "moss, ivy, rust, a plant growing out of stone or a crack (only if clearly visible)" },
  { id: "someone_was_here", line: "I found evidence someone was here before you.", when: "stickers, tags, a lock, a forgotten object, worn paint (only if clearly visible)" },
  { id: "repaired", line: "I found something somebody repaired.", when: "a visible patch, tape, a replaced part in a different color (only if clearly visible)" },
  { id: "doesnt_belong", line: "I found something that doesn't belong here.", when: "an object clearly out of place in this setting" },
  { id: "plain_sight", line: "I found something hiding in plain sight.", when: "small fixtures nobody looks at: small plaques, vents, boxes on poles, labels" },
  { id: "look_up", line: "You'd only see it if you looked up.", when: "things high above eye level: crests, carvings, signs on facades, rooftop details" },
  { id: "underfoot", line: "Everybody walks over it. Nobody looks at it.", when: "things on the ground: drain covers, manholes, plaques set in the pavement" },
  { id: "handmade", line: "Somebody made this by hand.", when: "carvings, murals, painted details, handmade signs" },
  { id: "only_color", line: "Nothing else here is quite this color.", when: "an object whose color is unique in the scene" },
  { id: "smaller_people", line: "It was made for someone smaller than you.", when: "playground equipment" },
  { id: "water", line: "It has something to do with water.", when: "fountains, taps, drains, gutters, pumps" },
  { id: "unwanted", line: "It swallows what nobody wants.", when: "bins" },
  { id: "without_words", line: "It tells everyone what to do without a single word.", when: "traffic signs, pictograms, symbols" },
] as const;

export type LensId = (typeof LENS_MENU)[number]["id"];

const LENS_RULES: Array<[RegExp, LensId]> = [
  [/\b(clock|sundial)\b/i, "keeps_time"],
  [/\b(lamp|lamppost|lamp post|lantern|street ?light|light pole|light fixture)\b/i, "after_dark"],
  [/\b(slide|swing|seesaw|see-saw|playground|play structure|playhouse|play house|play equipment|climbing frame|jungle gym|merry-go-round|roundabout|sandpit|sandbox|spring rider)\b/i, "smaller_people"],
  [/\b(bin|trash|rubbish|litter|garbage|waste)\b/i, "unwanted"],
  [/\b(fountain|tap|faucet|drinking|gutter|downpipe|hydrant|pump)\b/i, "water"],
  [/\b(drain|manhole|grate|grating|sewer|utility cover|access cover)\b/i, "underfoot"],
  [/\b(house number|street name|street sign|address|number plate|name plate|map)\b/i, "where_you_are"],
  [/\b(memorial|monument|commemorat\w*|statue|bust|obelisk|inscription|inscribed|engraved|dedicat\w*|crest|coat of arms|heraldic|years?|dates?|1[5-9]\d\d|20\d\d)\b/i, "remember"],
  [/\b(planter|flower ?pot|potted|hanging basket|flower box|window box)\b/i, "cared_for"],
  [/\b(parking sign|traffic sign|road sign|pictogram|no entry|stop sign)\b/i, "without_words"],
  [/\b(plaque|label|notice|placard|information board|info board|informational sign|sign)\b/i, "read_me"],
  [/\b(gate|turnstile|barrier)\b/i, "who_gets_in"],
  [/\b(bench|seat|bus stop|mailbox|letterbox|post box)\b/i, "waiting"],
];

export function lensFor(label: string, modelChoice?: string): LensId | undefined {
  const subject = withoutLocation(label);
  for (const [re, id] of LENS_RULES) if (re.test(subject)) return id;
  return LENS_MENU.find((l) => l.id === modelChoice)?.id;
}

export const MENU_WRITER_SYSTEM = `You prepare a secret target for "Can You Find It?", a real-world game.
A player is standing in a public place. A target was chosen in the scene. The player will put the phone away and look for it with their own eyes.
Image 1 is a close-up of the target. Image 2 is the whole scene.

Choose the ONE line below that is TRUE for this exact object and most fun to hunt with. Prefer a surprising line, but a line marked "only if clearly visible" needs evidence you can really see in image 1.
${LENS_MENU.map((l) => `- ${l.id}: "${l.line}" (for ${l.when})`).join("\n")}

Then write:
- evidence: what in image 1 makes that line true (max 12 words).
- hint_semantic: a more helpful hint about what it is for or what it means, without naming it (max 14 words).
- hint_concrete: what it looks like: material, color, shape, size, height above the ground (max 14 words).
- detail: one small detail clearly visible in image 1 that the player can check once they find it. Only what you can see; no history, no guesses (max 14 words).`;

export const MENU_WRITER_PROMPT = (label: string) => `The target is: "${label}".`;

export const menuWriterSchema = {
  type: "object",
  properties: {
    lens: { type: "string", enum: LENS_MENU.map((l) => l.id) },
    evidence: { type: "string" },
    hint_semantic: { type: "string" },
    hint_concrete: { type: "string" },
    detail: { type: "string" },
  },
  required: ["lens", "evidence", "hint_semantic", "hint_concrete", "detail"],
};
