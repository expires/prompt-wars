// Promo voiceover script: one ElevenLabs clip per section (scripts/voiceover.ts), verbatim.
export const PROMO_SECTIONS = [
  { id: 's1', text: "This is Prompt Wars. It's a multiplayer shooter where you don't pick your gun. You type it." },
  {
    id: 's2',
    text: "Games are rigid. You get the guns and skins the studio decided to make, and that's it. And every one of those costs money. A single weapon model is usually fifteen hundred to three thousand dollars, and a couple of weeks of an artist's time. Meanwhile players spend billions just to make their stuff look different. Counter-Strike skins alone are worth about six billion.",
  },
  {
    id: 's2b',
    text: "Prompt Wars takes that load off the developers. Players make the content themselves, so the game never runs out of new stuff, and every match looks different. It turns players into creators.",
  },
  {
    id: 's3',
    text: "So we flipped it. You start in the closet. Type a character, say a medieval knight in battered plate armour, and it builds in front of you, piece by piece. Bigger body means more health, but you're easier to hit.",
  },
  {
    id: 's4',
    text: "Then the forge. Fire sniper rifle with a glowing ember scope. Claude designs it part by part, then our code fixes the proportions and balances the stats. So it can look like anything, but it can't be overpowered.",
  },
  {
    id: 's5',
    text: "Then you're in. The map is the arena we're sitting in right now, rebuilt from scans and photos. Fire burns, ice slows you down, and heavy guns make you slower.",
  },
  { id: 's6', text: "We load tested it with three hundred and twenty bots, and we've had twenty real people playing and prompting at the same time." },
  {
    id: 's7',
    text: "Each gun costs us about two cents to make. On a cheaper model, it's a fraction of that. We'd charge a small monthly sub for more generations. But the bigger thing is the prompts. Every prompt is a player telling you exactly what they want. Other studios could use that as a reference for their own skin lines, and see what people actually want before they spend money making it.",
  },
  { id: 's8', text: "Prompt Wars. It's live right now. Go and make something stupid." },
] as const;

export type SectionId = (typeof PROMO_SECTIONS)[number]['id'];
