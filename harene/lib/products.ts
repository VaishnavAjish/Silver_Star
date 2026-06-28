export type Category = "rings" | "necklaces" | "earrings" | "bracelets";

export interface Product {
  slug: string;
  name: string;
  category: Category;
  collection: string;
  price: number;
  metal: string;
  stone: string;
  carat: string;
  story: string;
  details: string[];
  /** hue used by the procedural 3D viewer + card gradient */
  gem: string;
}

export const COLLECTIONS: {
  slug: Category;
  name: string;
  tagline: string;
  description: string;
}[] = [
  {
    slug: "rings",
    name: "Rings",
    tagline: "Vows in light",
    description:
      "Solitaires and sculpted bands. Each ring is a single gesture — a circle that holds a promise.",
  },
  {
    slug: "necklaces",
    name: "Necklaces",
    tagline: "The line of the throat",
    description:
      "Pendants and rivières that trace the collarbone, drawn to catch candlelight and conversation.",
  },
  {
    slug: "earrings",
    name: "Earrings",
    tagline: "Movement & shimmer",
    description:
      "Studs, drops and chandeliers engineered to sway — light in perpetual motion beside the face.",
  },
  {
    slug: "bracelets",
    name: "Bracelets",
    tagline: "Around the pulse",
    description:
      "Bangles and tennis lines that close around the wrist like a held breath of gold.",
  },
];

export const PRODUCTS: Product[] = [
  {
    slug: "lumiere-solitaire",
    name: "Lumière Solitaire",
    category: "rings",
    collection: "Éternel",
    price: 14800,
    metal: "18k yellow gold",
    stone: "Brilliant-cut diamond",
    carat: "1.80 ct",
    gem: "#dfe9ff",
    story:
      "A single brilliant raised on six fluted prongs, set high to let light pass clean through the stone. The band tapers to a knife-edge so nothing competes with the diamond.",
    details: [
      "Center stone: 1.80 ct, D colour, VVS1 clarity",
      "Hand-fluted six-prong basket setting",
      "Knife-edge tapered band, 1.9mm",
      "GIA certified, conflict-free origin",
    ],
  },
  {
    slug: "noir-eternity",
    name: "Noir Éternity",
    category: "rings",
    collection: "Éternel",
    price: 9650,
    metal: "Blackened 18k gold",
    stone: "Black & white diamonds",
    carat: "2.10 ct total",
    gem: "#bfc6d4",
    story:
      "An eternity band that runs from shadow to light — blackened gold pavé fading into white brilliance, a single rotation through dusk and dawn.",
    details: [
      "42 graduated diamonds, 2.10 ct total",
      "Rhodium-blackened 18k gold",
      "Channel-set full eternity",
      "Available in half-sizes",
    ],
  },
  {
    slug: "celeste-riviere",
    name: "Céleste Rivière",
    category: "necklaces",
    collection: "Firmament",
    price: 28400,
    metal: "Platinum",
    stone: "Graduated diamonds",
    carat: "9.40 ct total",
    gem: "#eef4ff",
    story:
      "A river of light. Forty-one graduated brilliants set in near-invisible platinum cups, articulated so the line moves like water against the skin.",
    details: [
      "41 graduated round brilliants, 9.40 ct",
      "Hand-articulated platinum links",
      "Concealed box clasp with figure-eight safety",
      "Adjustable 40–43cm",
    ],
  },
  {
    slug: "aurore-pendant",
    name: "Aurore Pendant",
    category: "necklaces",
    collection: "Firmament",
    price: 6200,
    metal: "18k rose gold",
    stone: "Champagne diamond",
    carat: "1.15 ct",
    gem: "#f6dcae",
    story:
      "A warm champagne diamond suspended in a halo of rose gold, drawn from the first light of morning. It rests exactly where the collarbones meet.",
    details: [
      "Center: 1.15 ct fancy champagne diamond",
      "18k rose gold halo, 0.30 ct pavé",
      "Cable chain, 45cm with 42cm loop",
      "Engravable reverse",
    ],
  },
  {
    slug: "cascade-drops",
    name: "Cascade Drops",
    category: "earrings",
    collection: "Firmament",
    price: 11900,
    metal: "Platinum",
    stone: "Pear & round diamonds",
    carat: "4.60 ct total",
    gem: "#e9f0ff",
    story:
      "Pear-cut drops hung from a line of round brilliants, weighted to swing with the smallest turn of the head. Light falls from them like water off a leaf.",
    details: [
      "2 pear drops + 14 round brilliants, 4.60 ct",
      "Articulated platinum mounts",
      "Post & friction back with security notch",
      "Drop length 38mm",
    ],
  },
  {
    slug: "solis-studs",
    name: "Solis Studs",
    category: "earrings",
    collection: "Éternel",
    price: 4350,
    metal: "18k yellow gold",
    stone: "Brilliant diamonds",
    carat: "1.50 ct total",
    gem: "#fff2cf",
    story:
      "Two suns, set close. A pair of matched brilliants in a low martini setting that sits flush to the ear and catches the room from every angle.",
    details: [
      "Matched pair, 0.75 ct each",
      "Three-prong martini setting",
      "18k gold posts, La Pousette backs",
      "G colour, VS clarity matched",
    ],
  },
  {
    slug: "ondine-bangle",
    name: "Ondine Bangle",
    category: "bracelets",
    collection: "Firmament",
    price: 8900,
    metal: "18k white gold",
    stone: "Pavé diamonds",
    carat: "3.20 ct total",
    gem: "#eaf1ff",
    story:
      "A liquid hinge of white gold, pavé-set along its crest so the wrist seems ringed in frost. It opens on a concealed spring and closes without a seam.",
    details: [
      "Crest pavé, 3.20 ct, 1.4mm stones",
      "18k white gold, hinged cuff",
      "Concealed push-clasp",
      "Inner circumference 17cm",
    ],
  },
  {
    slug: "fil-dor-tennis",
    name: "Fil d'Or Tennis",
    category: "bracelets",
    collection: "Éternel",
    price: 16700,
    metal: "18k yellow gold",
    stone: "Graduated diamonds",
    carat: "7.00 ct total",
    gem: "#fff4d4",
    story:
      "A continuous thread of gold and light — forty-four diamonds in shared four-prong settings, flexible as ribbon, closed with a clasp that disappears.",
    details: [
      "44 round brilliants, 7.00 ct total",
      "Shared four-prong gold settings",
      "Integrated double-lock clasp",
      "Length 18cm, sizeable",
    ],
  },
];

export function getProduct(slug: string) {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function byCategory(cat: Category) {
  return PRODUCTS.filter((p) => p.category === cat);
}

export function getCollection(slug: string) {
  return COLLECTIONS.find((c) => c.slug === slug);
}

export const currency = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
