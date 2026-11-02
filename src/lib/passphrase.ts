/**
 * Passphrases like "ember-goblin-lantern-harbour-42": easy to read out, copy or write down,
 * and random enough (~46 bits from a cryptographic source) that guessing is hopeless behind
 * Supabase's sign-in rate limits. Every account gets its own, so there's nothing to reuse or leak.
 */
const WORDS = (`
acorn adder amber anchor anvil apple arrow ash aspen atlas autumn axe badger banner barley barrel basin
beacon bear beetle bell berry birch bison blade blaze bloom boar bolt bone bramble brass breeze brick bridge
brook bucket buckle cabin cactus candle canyon cape carrot castle cedar cellar chalk charm cherry chest cinder
cliff cloak clover coal cobble comet copper coral cotton crab crane crater creek crown crystal current dagger
daisy dawn desert dew dragon drum dune eagle ember emerald falcon feather fern ferry fiddle field fig flame
flask flint forest forge fossil fox frost garnet garden gecko geyser ghost giant glacier goblin goose granite
grape gravel griffin grove gull hammer harbour harp hawk hazel heron hill hollow honey hood horn husk ice
island ivory ivy jade jasper jester jungle kelp kettle kiln kite knight lagoon lake lantern lark lava leaf
lemon lily lion lizard lobster loom lotus lute lynx magpie maple marble marsh meadow mesa mill minnow mint
mist moat monk moon moss moth mountain mule mushroom needle nettle newt night oak oar oasis ocean olive onyx
opal orchard otter owl oyster paddle palm panther parrot path peach pearl pebble pepper pike pine pirate plum
pond poppy potion prism puffin quarry quartz quill rabbit raft rain raven reed ridge river robin rook rope
rose ruby rune saddle sage salmon sand sapphire scroll seal shadow shell shield shrine silver skiff sled
slate snail sparrow spear spice spire spring spruce squid star stone storm stream summit swan sword thistle
thorn thunder tide tiger timber toad topaz torch tower trail trout tulip tundra turnip valley velvet vine
violet viper walnut walrus wand wave weasel well whale wheat willow wind wizard wolf wren yew zephyr
`).trim().split(/\s+/);

function randomInt(max: number): number {
  // Rejection sampling avoids modulo bias
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
}

export function generatePassphrase(): string {
  const words = Array.from({ length: 5 }, () => WORDS[randomInt(WORDS.length)]);
  return `${words.join('-')}-${10 + randomInt(90)}`;
}

/** Random placeholder login address. Never shown to anyone; `.invalid` can't receive mail. */
export function newLoginEmail(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}@players.gmw.invalid`;
}

/** Forgive stray spaces and capitals when people type their passphrase back in. */
export const normalisePassphrase = (p: string) => p.trim().toLowerCase().replace(/\s+/g, '-');
