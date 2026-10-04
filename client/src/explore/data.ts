/**
 * CityScape content: landmarks and secrets placed in the frame of the processed
 * `krakow-oldtown` GLB (a stylised medieval reconstruction; real lat / lon does not map onto it).
 *
 * The model is turned ~90° from a real map: +x points roughly north (Floriańska runs to the
 * Barbican along +x), +z roughly east. Street level is y = 5.67; the Wawel plateau is y = 22.3.
 * `stand` points are snapped to the nav grid at runtime, so they only need to be close.
 */

export type XZ = [number, number];
export type XYZ = [number, number, number];

export const MAP_URL = '/maps/krakow-oldtown.glb';
export const STREET_Y = 5.67;

/** nav grid + top-down map image bounds (scripts/map/bake-navgrid.ts / bake-topdown.ts) */
export const NAV = { minX: -446, minZ: -258, cell: 0.5, width: 1716, height: 996 } as const;
export const MAP_IMAGE = { minX: -446, minZ: -258, maxX: 412, maxZ: 240, ppm: 2 } as const;

/** compass bearing (degrees from north) of world +x; the model is a little skewed from real north */
export const NORTH_OFFSET_DEG = 25;

/** where a new visit starts: the south-west corner of the Market Square, facing St Mary's */
export const SPAWN = { pos: [60, STREET_Y, -8] as XYZ, yaw: Math.atan2(-80, -18) };

export interface Landmark {
  id: string;
  name: string;
  /** Polish name + a pronunciation guide */
  polish: string;
  say: string;
  /** spoken / captioned on discovery: one or two short sentences */
  short: string;
  /** the info card (E): short paragraphs in plain language */
  story: string[];
  /** a quick fact for the card's footer */
  fact: string;
  /** horizontal centre of the discovery area */
  at: XZ;
  radius: number;
  /** what the beacon / guide points at (top of a tower, a dome...) */
  look: XYZ;
  /** where the guide walks you (snapped to the nav grid) */
  stand: XZ;
}

export interface Secret {
  id: string;
  name: string;
  /** shown in the journal before it is found */
  hint: string;
  /** read out / shown when found */
  found: string[];
  /** "E: <verb>" prompt when in range (secrets found by walking / looking have none) */
  verb?: string;
  at: XZ;
  radius: number;
  /** where the guide walks you when you ask for this secret's location */
  stand: XZ;
}

/** The Royal Route order: the guide's "next landmark" follows it. */
export const LANDMARKS: Landmark[] = [
  {
    id: 'rynek',
    name: 'Main Market Square',
    polish: 'Rynek Główny',
    say: 'RIH-nek GWOOV-nih',
    short: 'You are standing in the Main Market Square, the heart of Kraków since 1257.',
    story: [
      'After the Tatar raid of 1241, Duke Bolesław the Chaste gave Kraków a new town charter in 1257. Merchants laid out this great square, and the streets around it in a neat grid.',
      'The real square is about 200 by 200 metres, one of the largest medieval town squares in Europe. Markets, royal parades, executions and festivals all happened here.',
      'Look around: the Cloth Hall stands in the middle, St Mary’s Basilica in one corner and the Town Hall Tower in another.',
    ],
    fact: 'Kraków was the capital of Poland until 1596.',
    at: [111, -48],
    radius: 60,
    look: [111, 16, -48],
    stand: [70, -60],
  },
  {
    id: 'sukiennice',
    name: 'Cloth Hall',
    polish: 'Sukiennice',
    say: 'soo-kyeh-NEE-tseh',
    short: 'The Cloth Hall: Kraków’s market hall for more than seven hundred years.',
    story: [
      'Merchants traded here from the 1200s: cloth from Flanders, and spices, silk and salt from all over the world.',
      'After a fire in 1555 the hall was rebuilt in Renaissance style, with a decorated top edge full of carved faces called mascarons.',
      'Walk through the long passage in the middle. Something unusual hangs from the ceiling there…',
    ],
    fact: 'Today the upstairs floor is a gallery of 19th-century Polish paintings.',
    at: [112, -46],
    radius: 30,
    look: [112.5, 18, -46],
    stand: [112, -47],
  },
  {
    id: 'mariacki',
    name: 'St Mary’s Basilica',
    polish: 'Kościół Mariacki',
    say: 'KOSH-chew mar-YAHTS-kee',
    short: 'St Mary’s Basilica, with its two towers of different heights.',
    story: [
      'This brick Gothic church was rebuilt in the 1300s by the city’s merchants. Inside is the wooden altarpiece by Veit Stoss, finished in 1489: one of the largest Gothic altarpieces in the world.',
      'The taller tower was the city’s watchtower and wears a golden crown. The lower one holds the bells.',
      'Legend says two brothers built the towers. When the younger brother’s tower grew taller, the elder killed him in jealousy. Some say the knife still hangs in the Cloth Hall.',
      'Every hour a trumpeter plays the hejnał from the taller tower. Listen: the tune stops suddenly in the middle of a note.',
    ],
    fact: 'The hejnał has been broadcast on Polish Radio at noon every day since 1927.',
    at: [140, 20],
    radius: 28,
    look: [143.1, 45.7, 10.4],
    stand: [128, -5],
  },
  {
    id: 'ratusz',
    name: 'Town Hall Tower',
    polish: 'Wieża Ratuszowa',
    say: 'VYEH-zha rah-too-SHO-vah',
    short: 'The Town Hall Tower: all that is left of Kraków’s old town hall.',
    story: [
      'The town hall itself was knocked down in 1820. Only this Gothic tower was kept.',
      'In 1703 a storm wind pushed the tower so hard that it still leans, about 55 centimetres off straight.',
      'Its deep cellars were once a prison with a torture chamber. Later they became a beer hall, and today a theatre.',
    ],
    fact: 'The tower is about 70 metres tall in real life.',
    at: [85, -76],
    radius: 18,
    look: [85.1, 43.8, -75.6],
    stand: [74, -70],
  },
  {
    id: 'wojciech',
    name: 'St Adalbert’s Church',
    polish: 'Kościół św. Wojciecha',
    say: 'KOSH-chew VOY-cheh-hah',
    short: 'St Adalbert’s, one of the oldest stone churches in Kraków.',
    story: [
      'This small domed church is older than the square around it: its stone walls date from the 11th and 12th centuries.',
      'Over the centuries the square was paved again and again and slowly rose. Today you step about two metres down to reach the church door.',
      'Legend says Saint Adalbert preached here around the year 997.',
    ],
    fact: 'Archaeologists found remains of older buildings underneath it.',
    at: [75.5, -11],
    radius: 14,
    look: [75.4, 14, -10.8],
    stand: [68, -4],
  },
  {
    id: 'florianska',
    name: 'St Florian’s Gate',
    polish: 'Brama Floriańska',
    say: 'BRAH-mah flor-YAHN-skah',
    short: 'St Florian’s Gate, the start of the Royal Route.',
    story: [
      'Kraków once had eight city gates. This one, built around 1300, is the only one still standing.',
      'In the 1800s the city walls were pulled down and replaced with a ring of gardens called the Planty.',
      'A professor, Feliks Radwański, persuaded the city to keep this short stretch. He argued the walls shielded the town from cold north winds.',
      'Kings rode in through this gate on their way to be crowned at Wawel.',
    ],
    fact: 'Artists sell paintings along this stretch of wall today.',
    at: [350, 4],
    radius: 18,
    look: [351.6, 22, 4.4],
    stand: [340, 4.4],
  },
  {
    id: 'barbakan',
    name: 'The Barbican',
    polish: 'Barbakan',
    say: 'bar-BAH-kahn',
    short: 'The Barbican: a round fortress that guarded St Florian’s Gate.',
    story: [
      'It was built in 1498 and 1499 by King John Albert, after a lost battle made the city fear an attack.',
      'Its brick walls are three metres thick, with 130 slits for archers and gunners. A drawbridge over the moat once linked it to the gate.',
      'Very few barbicans like this survive anywhere in Europe.',
    ],
    fact: 'Its round shape gave defenders a view in every direction.',
    at: [382, 0],
    radius: 22,
    look: [384.6, 16, -0.1],
    stand: [369, -1.2],
  },
  {
    id: 'collegium',
    name: 'Collegium Maius',
    polish: 'Collegium Maius',
    say: 'koh-LEH-gee-oom MY-oos',
    short: 'Collegium Maius, the oldest building of the Jagiellonian University.',
    story: [
      'King Casimir the Great founded Kraków’s university in 1364. It is the oldest university in Poland.',
      'Nicolaus Copernicus studied here from 1491 to 1495. Years later he showed that the Earth moves around the Sun.',
      'The building is arranged around a quiet arcaded courtyard. A clock there plays a tune while carved figures parade past.',
    ],
    fact: 'The university museum keeps astronomical instruments from Copernicus’s time.',
    at: [45, -172],
    radius: 22,
    look: [45.4, 16, -175],
    stand: [39, -163],
  },
  {
    id: 'franciszkanie',
    name: 'Franciscan Basilica',
    polish: 'Bazylika Franciszkanów',
    say: 'bah-ZIH-lee-kah fran-cheesh-KAH-noof',
    short: 'The Franciscan Basilica, famous for its glowing stained glass.',
    story: [
      'The Franciscan friars arrived in Kraków in 1237 and built this large brick church.',
      'Around 1900 the artist Stanisław Wyspiański designed its stained-glass windows: swirling flowers, and God the Father creating the world.',
      'Across the street stands the Bishops’ Palace. Look for a special window there.',
    ],
    fact: 'The church was badly burned in the great fire of 1850 and restored afterwards.',
    at: [-60, -17],
    radius: 30,
    look: [-65.4, 22, -17],
    stand: [-28, -16],
  },
  {
    id: 'dominikanie',
    name: 'Dominican Basilica',
    polish: 'Bazylika Dominikanów',
    say: 'bah-ZIH-lee-kah doh-mee-nee-KAH-noof',
    short: 'The Dominican Basilica of the Holy Trinity.',
    story: [
      'The Dominican friars came to Kraków in 1222, invited by Bishop Iwo Odrowąż.',
      'Their church and its cloister are full of chapels and tombstones of old Kraków families.',
      'In 1850 a great fire swept through this part of town and the church had to be rebuilt.',
    ],
    fact: 'The friars still live and pray here today.',
    at: [20, 75],
    radius: 25,
    look: [19.6, 20, 80.9],
    stand: [22, 58],
  },
  {
    id: 'grodzka',
    name: 'The Royal Route on Grodzka Street',
    polish: 'Ulica Grodzka',
    say: 'oo-LEE-tsah GROD-skah',
    short: 'Grodzka Street, part of the Royal Route between the square and Wawel.',
    story: [
      'The Royal Route runs from St Florian’s Gate, through the Market Square and down Grodzka Street to Wawel Castle.',
      'Kings rode this way to their coronations, and their funeral processions followed it too.',
      'Grodzka is one of the oldest streets in the city. Its name means “the street to the castle”.',
    ],
    fact: 'Follow the street towards the hill to reach Wawel.',
    at: [-50, 45],
    radius: 14,
    look: [-50, 10, 45.9],
    stand: [-50, 45],
  },
  {
    id: 'piotrpawel',
    name: 'Church of Saints Peter and Paul',
    polish: 'Kościół św. Piotra i Pawła',
    say: 'KOSH-chew PYOH-trah ee PAH-vwah',
    short: 'Saints Peter and Paul, Kraków’s first Baroque church.',
    story: [
      'King Sigismund the Third had this church built for the Jesuits between 1597 and 1619.',
      'Statues of the twelve apostles stand on the fence in front.',
      'Its high dome is used to show Foucault’s pendulum: a long swinging weight that proves the Earth spins.',
    ],
    fact: 'The pendulum hangs on a wire about 46 metres long.',
    at: [-111, 128],
    radius: 22,
    look: [-110.4, 26, 130.9],
    stand: [-111, 112],
  },
  {
    id: 'katedra',
    name: 'Wawel Cathedral',
    polish: 'Katedra Wawelska',
    say: 'kah-TEH-drah vah-VEL-skah',
    short: 'Wawel Cathedral, where Polish kings were crowned and buried.',
    story: [
      'For centuries Polish kings were crowned here, and most of them are buried here too.',
      'The chapel with the golden dome is the Sigismund Chapel, built between 1519 and 1533. Many call it the finest Renaissance chapel north of the Alps.',
      'In the Sigismund Tower hangs the Zygmunt Bell, cast in 1520 and weighing nearly 13 tonnes. It rings only on the most important days.',
      'By the door hang some very old bones. Go and see whose they are said to be.',
    ],
    fact: 'Pope John Paul II celebrated his first Mass as a priest in the cathedral crypt in 1946.',
    at: [-300, 78],
    radius: 30,
    look: [-309.9, 54, 81.4],
    stand: [-315, 75],
  },
  {
    id: 'zamek',
    name: 'Wawel Royal Castle',
    polish: 'Zamek Królewski na Wawelu',
    say: 'ZAH-mek kroo-LEV-skee nah vah-VEH-loo',
    short: 'Wawel Royal Castle and its arcaded Renaissance courtyard.',
    story: [
      'King Sigismund the Old rebuilt the castle in the early 1500s, with Italian architects.',
      'The courtyard is lined with arcades on three floors, a little piece of Italy on a Polish hill.',
      'Inside, the castle keeps huge tapestries woven in Flanders for King Sigismund Augustus.',
    ],
    fact: 'Wawel Hill has been a seat of power for more than a thousand years.',
    at: [-284, 128],
    radius: 22,
    look: [-284, 34, 128],
    stand: [-284, 127],
  },
  {
    id: 'smok',
    name: 'The Dragon’s Den',
    polish: 'Smocza Jama',
    say: 'SMOT-chah YAH-mah',
    short: 'The Dragon’s Den, a cave under Wawel Hill. Something here breathes fire!',
    story: [
      'Long ago, says the legend, a dragon lived in this cave and ate the townspeople’s sheep and cattle.',
      'A clever shoemaker stuffed a sheep with sulfur and left it at the cave. The dragon ate it, grew terribly thirsty, drank half the Vistula river, and burst.',
      'Since 1972 a bronze dragon by the sculptor Bronisław Chromy has stood at the cave mouth. It really breathes fire.',
    ],
    fact: 'The real cave is about 270 metres long, and visitors walk through part of it.',
    at: [-395, 146],
    radius: 18,
    look: [-395, 12, 141],
    stand: [-395, 152],
  },
];

export const SECRETS: Secret[] = [
  {
    id: 'hejnal',
    name: 'The broken trumpet call',
    hint: 'Stand near St Mary’s Basilica and listen for the trumpet from the tall tower.',
    found: [
      'You heard the hejnał, the trumpet call of St Mary’s.',
      'Legend says that in 1241 a watchman saw Tatar raiders approaching and sounded the alarm. An arrow struck him in the throat mid-tune. To this day, the call stops at that very note.',
    ],
    at: [140, 20],
    radius: 70,
    stand: [128, -5],
  },
  {
    id: 'noz',
    name: 'The knife in the Cloth Hall',
    hint: 'Walk through the passage in the middle of the Cloth Hall and look up.',
    verb: 'Look at the knife',
    found: [
      'A large old knife hangs from the ceiling of the Cloth Hall.',
      'One legend says it is the knife from the story of St Mary’s two brothers. Another says it was a warning to thieves and cheats at the market.',
    ],
    at: [112, -46],
    radius: 6,
    stand: [112, -47],
  },
  {
    id: 'golebie',
    name: 'The enchanted knights',
    hint: 'Walk into the flock of pigeons in the Market Square.',
    found: [
      'The pigeons scatter… but are they really pigeons?',
      'Legend says Duke Henryk Probus wanted to be crowned king. A witch turned his knights into pigeons so they could peck gold from St Mary’s church for his journey to Rome. He spent the gold and never came back, so the knights stayed pigeons forever.',
    ],
    at: [100, -10],
    radius: 4,
    stand: [100, -14],
  },
  {
    id: 'obwarzanek',
    name: 'An obwarzanek for the road',
    hint: 'Find the blue street cart in the Market Square.',
    verb: 'Buy an obwarzanek',
    found: [
      'You bought an obwarzanek: a braided ring of bread, boiled and then baked, with poppy seeds or salt on top.',
      'Bakers sold them in Kraków as early as 1394. Since 2010 the name is protected by the European Union, like champagne.',
    ],
    at: [152, -40],
    radius: 4,
    stand: [149, -40],
  },
  {
    id: 'lajkonik',
    name: 'A tap from the Lajkonik',
    hint: 'A rider on a wooden horse is waiting at the north side of the Market Square.',
    verb: 'Greet the Lajkonik',
    found: [
      'The Lajkonik taps you with his mace. That is supposed to bring a whole year of good luck!',
      'Every June, a week after Corpus Christi, a man dressed as a Tatar rider on a hobby horse dances through town to the Market Square. His costume was designed by Stanisław Wyspiański in 1904.',
    ],
    at: [150, -80],
    radius: 4,
    stand: [147, -78],
  },
  {
    id: 'kopernik',
    name: 'Copernicus’s sphere',
    hint: 'Near the old university building there is a brass model of the sky.',
    verb: 'Spin the sphere',
    found: [
      'The rings of the armillary sphere spin around the Sun.',
      'Copernicus studied in Kraków from 1491 to 1495. In 1543 his book showed that the Earth goes around the Sun, not the other way round.',
    ],
    at: [41, -166],
    radius: 4,
    stand: [39, -163],
  },
  {
    id: 'okno',
    name: 'The Pope’s Window',
    hint: 'Across from the Franciscan Basilica, one window of the Bishops’ Palace is special.',
    verb: 'Look at the window',
    found: [
      'This is the Pope’s Window at Franciszkańska 3.',
      'When Pope John Paul II, who had been Archbishop of Kraków, came home to visit, he talked and joked with the crowds from this window late into the night.',
    ],
    at: [-36, -24],
    radius: 5,
    stand: [-36, -24],
  },
  {
    id: 'kosci',
    name: 'The dragon’s bones',
    hint: 'Look by the entrance of Wawel Cathedral.',
    verb: 'Look at the bones',
    found: [
      'Huge bones hang on chains by the cathedral door. People said they belonged to the Wawel dragon.',
      'They are really the bones of prehistoric animals, perhaps a mammoth and a whale. Legend says the world will end on the day they fall.',
    ],
    at: [-312, 72],
    radius: 5,
    stand: [-314, 74],
  },
  {
    id: 'dzwon',
    name: 'Ring the Zygmunt Bell',
    hint: 'A copy of a famous bell waits near Wawel Cathedral.',
    verb: 'Ring the bell',
    found: [
      'BONG… The Zygmunt Bell’s deep voice rolls over the city.',
      'The real bell was cast in 1520 and needs a team of bell-ringers to swing it. They say if you touch its heart, the clapper, with your left hand, you will find love.',
    ],
    at: [-306, 64],
    radius: 5,
    stand: [-308, 66],
  },
  {
    id: 'czakram',
    name: 'The Wawel chakra',
    hint: 'One corner of the castle courtyard is said to hold a magical stone.',
    verb: 'Touch the wall',
    found: [
      'You lay your hand on the old wall. Do you feel the energy?',
      'A modern legend says one of the world’s seven chakra stones lies hidden here, under Wawel Hill. Visitors still touch the courtyard wall to soak up its power.',
    ],
    at: [-298, 114],
    radius: 5,
    stand: [-296, 116],
  },
  {
    id: 'owca',
    name: 'The shoemaker’s trick',
    hint: 'Find a sheep near the foot of Wawel Hill, then bring it to the dragon.',
    verb: 'Pick up the sheep',
    found: [
      'The dragon swallowed the sulfur sheep, drank and drank from the Vistula… and BANG!',
      'That is how the clever shoemaker saved Kraków, and married the king’s daughter. Do not worry: legends always come back.',
    ],
    at: [-226, 108],
    radius: 4,
    stand: [-224, 106],
  },
  {
    id: 'twardowski',
    name: 'Master Twardowski on the moon',
    hint: 'Look up at the moon for a few seconds.',
    found: [
      'Look closely: a tiny figure waves from the moon!',
      'Master Twardowski was a Kraków nobleman who sold his soul to the devil. When the devil came to collect him, Twardowski sang a hymn, and was left hanging on the moon. His only friend is a spider, who climbs down on a thread to bring him news from Earth.',
    ],
    at: [0, 0],
    radius: 0,
    stand: [111, -48],
  },
];

/** direction of the moon in the sky (unit vector from the viewer) */
export const MOON_DIR: XYZ = normalize([-0.55, 0.42, -0.72]);

function normalize(v: XYZ): XYZ {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Polish words the narrator says with a Polish voice when the device has one, else with this
 * English respelling (English voices mangle "ł", "ó", "sz"...). Longest first wins.
 */
export const SPOKEN_POLISH: [string, string][] = [
  ['Witaj w Krakowie', 'vee-tie f krah-koh-vyeh'],
  ['Zamek Królewski na Wawelu', 'zah-mek kroo-lev-skee nah vah-veh-loo'],
  ['Kościół św. Piotra i Pawła', 'kosh-chew shvyen-tego pyoh-trah ee pahv-wah'],
  ['Kościół św. Wojciecha', 'kosh-chew shvyen-tego voy-cheh-hah'],
  ['Bazylika Franciszkanów', 'bah-zih-lee-kah fran-cheesh-kah-noof'],
  ['Bazylika Dominikanów', 'bah-zih-lee-kah doh-mee-nee-kah-noof'],
  ['Kościół Mariacki', 'kosh-chew mar-yahts-kee'],
  ['Wieża Ratuszowa', 'vyeh-zhah rah-too-shoh-vah'],
  ['Brama Floriańska', 'brah-mah flor-yahn-skah'],
  ['Katedra Wawelska', 'kah-teh-drah vah-vel-skah'],
  ['Rynek Główny', 'rih-nek gwoov-nih'],
  ['Ulica Grodzka', 'oo-lee-tsah grots-kah'],
  ['Smocza Jama', 'smot-chah yah-mah'],
  ['Franciszkańska', 'fran-cheesh-kahn-skah'],
  ['Sukiennice', 'soo-kyeh-nee-tseh'],
  ['Barbakan', 'bar-bah-kahn'],
  ['obwarzanki', 'ob-vah-zhahn-kee'],
  ['obwarzanek', 'ob-vah-zhah-nek'],
  ['Smacznego', 'smahch-neh-goh'],
  ['Gratulacje', 'grah-too-lah-tsyeh'],
  ['Wyspiański', 'vis-pyahn-skee'],
  ['Twardowski', 'tvar-dof-skee'],
  ['Radwański', 'rad-vahn-skee'],
  ['Bolesław', 'boh-leh-swahf'],
  ['Odrowąż', 'oh-droh-vonzh'],
  ['Lajkonik', 'lie-koh-neek'],
  ['hejnał', 'hey-nahw'],
  ['Grodzka', 'grots-kah'],
];
