/**
 * Polish texts for the landmarks and legends in data.ts (keyed by id). Written so names stay in
 * the nominative (they are dropped into sentences like "Cel: Sukiennice") and second-person forms
 * stay gender-neutral (present tense, no "odkryłeś / odkryłaś").
 */
export interface PlaceText {
  name: string;
  short: string;
  story: string[];
  fact: string;
}

export interface LegendText {
  name: string;
  hint: string;
  verb?: string;
  found: string[];
}

export const PLACES_PL: Record<string, PlaceText> = {
  rynek: {
    name: 'Rynek Główny',
    short: 'Stoisz na Rynku Głównym, w sercu Krakowa od 1257 roku.',
    story: [
      'Po najeździe Tatarów w 1241 roku książę Bolesław Wstydliwy nadał Krakowi w 1257 roku nowy przywilej lokacyjny. Kupcy wytyczyli wtedy ten wielki plac, a wokół niego równą siatkę ulic.',
      'Prawdziwy rynek ma około 200 na 200 metrów i jest jednym z największych średniowiecznych placów miejskich w Europie. Odbywały się tu targi, królewskie przemarsze, egzekucje i święta.',
      'Rozejrzyj się: pośrodku stoją Sukiennice, w jednym narożniku Bazylika Mariacka, a w drugim Wieża Ratuszowa.',
    ],
    fact: 'Kraków był stolicą Polski do 1596 roku.',
  },
  sukiennice: {
    name: 'Sukiennice',
    short: 'Sukiennice: krakowska hala targowa od ponad siedmiuset lat.',
    story: [
      'Kupcy handlowali tu już w XIII wieku: suknem z Flandrii, a także przyprawami, jedwabiem i solą z całego świata.',
      'Po pożarze w 1555 roku halę przebudowano w stylu renesansowym. Dodano wtedy ozdobną attykę z rzeźbionymi głowami, zwanymi maszkaronami.',
      'Przejdź długim przejściem przez środek. Pod sklepieniem wisi tam coś niezwykłego…',
    ],
    fact: 'Na piętrze mieści się dziś galeria polskiego malarstwa XIX wieku.',
  },
  mariacki: {
    name: 'Bazylika Mariacka',
    short: 'Bazylika Mariacka, z dwiema wieżami różnej wysokości.',
    story: [
      'Ten ceglany gotycki kościół mieszczanie przebudowali w XIV wieku. W środku stoi drewniany ołtarz Wita Stwosza, ukończony w 1489 roku: jeden z największych gotyckich ołtarzy na świecie.',
      'Wyższa wieża była strażnicą miasta i nosi złotą koronę. Niższa to dzwonnica.',
      'Legenda mówi, że wieże budowało dwóch braci. Gdy wieża młodszego zaczęła przerastać wieżę starszego, ten zabił brata z zazdrości. Podobno nóż do dziś wisi w Sukiennicach.',
      'Co godzinę z wyższej wieży trębacz gra hejnał. Posłuchaj: melodia urywa się nagle w połowie nuty.',
    ],
    fact: 'Od 1927 roku Polskie Radio codziennie w południe nadaje hejnał mariacki.',
  },
  ratusz: {
    name: 'Wieża Ratuszowa',
    short: 'Wieża Ratuszowa: wszystko, co zostało z dawnego krakowskiego ratusza.',
    story: [
      'Sam ratusz rozebrano w 1820 roku. Zachowano tylko tę gotycką wieżę.',
      'W 1703 roku wichura naparła na wieżę tak mocno, że do dziś jest odchylona od pionu o około 55 centymetrów.',
      'Jej głębokie piwnice były kiedyś więzieniem z izbą tortur. Później działała tu piwiarnia, a dziś teatr.',
    ],
    fact: 'W rzeczywistości wieża ma około 70 metrów wysokości.',
  },
  wojciech: {
    name: 'Kościół św. Wojciecha',
    short: 'Kościół św. Wojciecha, jeden z najstarszych kamiennych kościołów Krakowa.',
    story: [
      'Ten mały kościółek z kopułą jest starszy niż otaczający go rynek: jego kamienne mury pochodzą z XI i XII wieku.',
      'Przez stulecia rynek wielokrotnie brukowano i jego poziom powoli się podnosił. Dziś do drzwi kościoła schodzi się około dwóch metrów w dół.',
      'Według legendy święty Wojciech wygłaszał tu kazania około 997 roku.',
    ],
    fact: 'Pod kościołem archeolodzy odkryli pozostałości jeszcze starszych budowli.',
  },
  florianska: {
    name: 'Brama Floriańska',
    short: 'Brama Floriańska, początek Drogi Królewskiej.',
    story: [
      'Kraków miał kiedyś osiem bram miejskich. Ta, zbudowana około 1300 roku, jako jedyna przetrwała.',
      'W XIX wieku mury miejskie rozebrano, a w ich miejscu założono pierścień ogrodów zwany Plantami.',
      'Profesor Feliks Radwański przekonał władze, by zostawić ten fragment. Twierdził, że mury chronią miasto przed zimnymi wiatrami z północy.',
      'Przez tę bramę wjeżdżali królowie w drodze na koronację na Wawelu.',
    ],
    fact: 'Dziś artyści sprzedają obrazy na tym odcinku murów.',
  },
  barbakan: {
    name: 'Barbakan',
    short: 'Barbakan: okrągła twierdza, która strzegła Bramy Floriańskiej.',
    story: [
      'Zbudował go król Jan Olbracht w latach 1498–1499, po przegranej bitwie, gdy obawiano się ataku na miasto.',
      'Ceglane mury mają trzy metry grubości i 130 otworów strzelniczych. Kiedyś łączył go z bramą most nad fosą.',
      'Bardzo niewiele podobnych barbakanów zachowało się w Europie.',
    ],
    fact: 'Okrągły kształt pozwalał obrońcom widzieć wroga z każdej strony.',
  },
  collegium: {
    name: 'Collegium Maius',
    short: 'Collegium Maius, najstarszy budynek Uniwersytetu Jagiellońskiego.',
    story: [
      'Król Kazimierz Wielki założył krakowski uniwersytet w 1364 roku. To najstarsza uczelnia w Polsce.',
      'Mikołaj Kopernik studiował tu w latach 1491–1495. Wiele lat później wykazał, że to Ziemia krąży wokół Słońca.',
      'Budynek otacza cichy dziedziniec z krużgankami. Zegar na dziedzińcu wygrywa melodię, a obok przesuwają się rzeźbione figurki.',
    ],
    fact: 'Muzeum uniwersytetu przechowuje instrumenty astronomiczne z czasów Kopernika.',
  },
  franciszkanie: {
    name: 'Bazylika Franciszkanów',
    short: 'Bazylika Franciszkanów, słynąca z barwnych witraży.',
    story: [
      'Franciszkanie przybyli do Krakowa w 1237 roku i zbudowali ten duży ceglany kościół.',
      'Około 1900 roku Stanisław Wyspiański zaprojektował jego witraże: kwiaty w zawijasach i Boga Ojca stwarzającego świat.',
      'Po drugiej stronie ulicy stoi Pałac Biskupi. Poszukaj tam wyjątkowego okna.',
    ],
    fact: 'Kościół spłonął podczas wielkiego pożaru w 1850 roku i został potem odbudowany.',
  },
  dominikanie: {
    name: 'Bazylika Dominikanów',
    short: 'Bazylika Dominikanów pod wezwaniem Trójcy Świętej.',
    story: [
      'Dominikanie przybyli do Krakowa w 1222 roku na zaproszenie biskupa Iwona Odrowąża.',
      'Ich kościół i klasztor pełne są kaplic i nagrobków dawnych krakowskich rodów.',
      'W 1850 roku przez tę część miasta przeszedł wielki pożar i kościół trzeba było odbudować.',
    ],
    fact: 'Zakonnicy wciąż tu mieszkają i się modlą.',
  },
  grodzka: {
    name: 'Droga Królewska: ulica Grodzka',
    short: 'Ulica Grodzka, część Drogi Królewskiej między Rynkiem a Wawelem.',
    story: [
      'Droga Królewska prowadzi od Bramy Floriańskiej przez Rynek Główny i ulicę Grodzką aż na Wawel.',
      'Tędy jechali królowie na koronację i tędy przechodziły ich kondukty pogrzebowe.',
      'Grodzka to jedna z najstarszych ulic miasta. Jej nazwa oznacza ulicę prowadzącą do grodu, czyli do zamku.',
    ],
    fact: 'Idź tą ulicą w stronę wzgórza, a dojdziesz na Wawel.',
  },
  piotrpawel: {
    name: 'Kościół św. Piotra i Pawła',
    short: 'Kościół św. Piotra i Pawła, pierwsza barokowa świątynia Krakowa.',
    story: [
      'Król Zygmunt III Waza zbudował ten kościół dla jezuitów w latach 1597–1619.',
      'Na ogrodzeniu przed wejściem stoją posągi dwunastu apostołów.',
      'Pod wysoką kopułą pokazuje się wahadło Foucaulta: długi, kołyszący się ciężarek, który dowodzi, że Ziemia się obraca.',
    ],
    fact: 'Wahadło wisi na lince o długości około 46 metrów.',
  },
  katedra: {
    name: 'Katedra Wawelska',
    short: 'Katedra Wawelska, gdzie koronowano i chowano polskich królów.',
    story: [
      'Przez stulecia koronowano tu polskich królów i większość z nich tu spoczywa.',
      'Kaplica ze złotą kopułą to Kaplica Zygmuntowska, zbudowana w latach 1519–1533. Wielu uważa ją za najpiękniejszą renesansową kaplicę na północ od Alp.',
      'W Wieży Zygmuntowskiej wisi Dzwon Zygmunt, odlany w 1520 roku, ważący prawie 13 ton. Bije tylko w najważniejsze dni.',
      'Przy wejściu wiszą bardzo stare kości. Sprawdź, do kogo podobno należały.',
    ],
    fact: 'Karol Wojtyła, późniejszy papież Jan Paweł II, odprawił swoją pierwszą mszę w krypcie katedry w 1946 roku.',
  },
  zamek: {
    name: 'Zamek Królewski na Wawelu',
    short: 'Zamek Królewski na Wawelu i jego renesansowy dziedziniec z krużgankami.',
    story: [
      'Król Zygmunt Stary przebudował zamek na początku XVI wieku razem z włoskimi architektami.',
      'Dziedziniec otaczają krużganki na trzech kondygnacjach: kawałek Italii na polskim wzgórzu.',
      'W zamku przechowywane są ogromne arrasy utkane we Flandrii dla króla Zygmunta Augusta.',
    ],
    fact: 'Wzgórze Wawelskie od ponad tysiąca lat jest siedzibą władzy.',
  },
  smok: {
    name: 'Smocza Jama',
    short: 'Smocza Jama, jaskinia pod Wawelem. Coś tu zieje ogniem!',
    story: [
      'Dawno temu, jak głosi legenda, w tej jaskini mieszkał smok, który pożerał owce i krowy mieszkańców.',
      'Sprytny szewczyk wypchał owcę siarką i zostawił ją przed jaskinią. Smok ją zjadł, poczuł straszne pragnienie, wypił pół Wisły i pękł.',
      'Od 1972 roku u wylotu jaskini stoi smok z brązu, dzieło Bronisława Chromego. Naprawdę zieje ogniem.',
    ],
    fact: 'Prawdziwa jaskinia ma około 270 metrów długości, a zwiedzający przechodzą przez jej część.',
  },
};

export const LEGENDS_PL: Record<string, LegendText> = {
  hejnal: {
    name: 'Urwany hejnał',
    hint: 'Stań w pobliżu Bazyliki Mariackiej i posłuchaj trąbki z wyższej wieży.',
    found: [
      'To był hejnał mariacki.',
      'Legenda mówi, że w 1241 roku strażnik dostrzegł nadciągających Tatarów i zagrał na alarm. Strzała trafiła go w gardło w połowie melodii. Do dziś hejnał urywa się w tym samym miejscu.',
    ],
  },
  noz: {
    name: 'Nóż w Sukiennicach',
    hint: 'Przejdź przejściem przez środek Sukiennic i spójrz w górę.',
    verb: 'Obejrzyj nóż',
    found: [
      'Pod sklepieniem Sukiennic wisi duży, stary nóż.',
      'Jedna legenda mówi, że to nóż z historii dwóch braci budujących wieże Mariackiego. Inna, że była to przestroga dla złodziei i oszustów na targu.',
    ],
  },
  golebie: {
    name: 'Zaczarowani rycerze',
    hint: 'Wejdź w stado gołębi na Rynku.',
    found: [
      'Gołębie się rozlatują… ale czy to na pewno gołębie?',
      'Legenda mówi, że książę Henryk Probus chciał zostać królem. Czarownica zamieniła jego rycerzy w gołębie, by wydziobali złoto z kościoła Mariackiego na podróż do Rzymu. Książę roztrwonił złoto i nigdy nie wrócił, więc rycerze na zawsze zostali gołębiami.',
    ],
  },
  obwarzanek: {
    name: 'Obwarzanek na drogę',
    hint: 'Znajdź niebieski wózek na Rynku.',
    verb: 'Kup obwarzanka',
    found: [
      'Oto obwarzanek: pleciony krąg ciasta, najpierw gotowany, potem pieczony, posypany makiem albo solą.',
      'Piekarze sprzedawali je w Krakowie już w 1394 roku. Od 2010 roku nazwa jest chroniona przez Unię Europejską, tak jak szampan.',
    ],
  },
  lajkonik: {
    name: 'Buława Lajkonika',
    hint: 'Jeździec na drewnianym koniku czeka po północnej stronie Rynku.',
    verb: 'Przywitaj się z Lajkonikiem',
    found: [
      'Lajkonik stuka cię buławą. To podobno przynosi szczęście na cały rok!',
      'Co roku w czerwcu, tydzień po Bożym Ciele, mężczyzna przebrany za tatarskiego jeźdźca na koniku tańczy przez miasto aż na Rynek. Jego strój zaprojektował Stanisław Wyspiański w 1904 roku.',
    ],
  },
  kopernik: {
    name: 'Sfera Kopernika',
    hint: 'Przy starym gmachu uniwersytetu stoi mosiężny model nieba.',
    verb: 'Zakręć sferą',
    found: [
      'Pierścienie sfery armilarnej wirują wokół Słońca.',
      'Kopernik studiował w Krakowie w latach 1491–1495. W 1543 roku jego dzieło wykazało, że to Ziemia krąży wokół Słońca, a nie odwrotnie.',
    ],
  },
  okno: {
    name: 'Okno Papieskie',
    hint: 'Naprzeciwko Bazyliki Franciszkanów jedno okno Pałacu Biskupiego jest wyjątkowe.',
    verb: 'Spójrz na okno',
    found: [
      'To Okno Papieskie przy ulicy Franciszkańskiej 3.',
      'Kiedy papież Jan Paweł II, dawny arcybiskup krakowski, przyjeżdżał do domu, rozmawiał i żartował z tłumami z tego okna do późnej nocy.',
    ],
  },
  kosci: {
    name: 'Smocze kości',
    hint: 'Rozejrzyj się przy wejściu do Katedry Wawelskiej.',
    verb: 'Obejrzyj kości',
    found: [
      'Przy drzwiach katedry wiszą na łańcuchach ogromne kości. Mówiono, że należały do smoka wawelskiego.',
      'Naprawdę to kości prehistorycznych zwierząt, być może mamuta i wieloryba. Legenda głosi, że świat skończy się w dniu, w którym spadną.',
    ],
  },
  dzwon: {
    name: 'Dzwon Zygmunt',
    hint: 'Przy Katedrze Wawelskiej czeka kopia słynnego dzwonu.',
    verb: 'Uderz w dzwon',
    found: [
      'BOM… Głęboki głos Dzwonu Zygmunta niesie się nad miastem.',
      'Prawdziwy dzwon odlano w 1520 roku, a do rozkołysania go potrzeba całej drużyny dzwonników. Mówi się, że kto dotknie lewą ręką jego serca, znajdzie miłość.',
    ],
  },
  czakram: {
    name: 'Wawelski czakram',
    hint: 'W jednym narożniku dziedzińca zamkowego podobno kryje się magiczny kamień.',
    verb: 'Dotknij muru',
    found: [
      'Kładziesz dłoń na starym murze. Czujesz energię?',
      'Współczesna legenda mówi, że pod Wawelem ukryty jest jeden z siedmiu czakramów świata. Zwiedzający wciąż dotykają muru dziedzińca, by zaczerpnąć jego mocy.',
    ],
  },
  owca: {
    name: 'Podstęp szewczyka',
    hint: 'Znajdź owcę u stóp Wawelu i zanieś ją smokowi.',
    verb: 'Podnieś owcę',
    found: [
      'Smok połknął owcę z siarką, pił i pił z Wisły… i BUM!',
      'Tak sprytny szewczyk uratował Kraków i ożenił się z królewską córką. Bez obaw: legendy zawsze wracają.',
    ],
  },
  twardowski: {
    name: 'Pan Twardowski na Księżycu',
    hint: 'Popatrz przez kilka sekund na Księżyc.',
    found: [
      'Przyjrzyj się: na Księżycu macha maleńka postać!',
      'Pan Twardowski był krakowskim szlachcicem, który zaprzedał duszę diabłu. Gdy diabeł przyszedł po niego, Twardowski zaśpiewał pieśń do Matki Bożej i zawisł na Księżycu. Jego jedynym przyjacielem jest pająk, który na nitce spuszcza się na Ziemię po nowiny.',
    ],
  },
};
