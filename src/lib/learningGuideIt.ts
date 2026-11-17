// The Learning page's guide in Italian (the English original and the types are in learningGuide.ts)

import type { Guide } from '@/lib/learningGuide';

export const IT: Guide = {
  title: 'L’arte di guidare un’auto da corsa',
  subtitle: 'Una guida pratica e illustrata per piloti principianti e di livello intermedio',
  topics: ['Dinamica del veicolo', 'Traiettoria', 'Frenata', 'Frenata in inserimento', 'Rotazione', 'Telemetria'],
  note: 'Pensata per il motorsport su circuito chiuso e per i simulatori di guida, con esempi su GT3. Sulle auto reali le tecniche vanno provate in modo graduale e sotto la supervisione di istruttori qualificati.',
  chapters: [
    {
      id: 'race-car-dynamics',
      title: 'Capire la dinamica di un’auto da corsa',
      summary: 'Quattro impronte a terra, il trasferimento di carico e da dove viene il grip.',
      figureTitle: 'Il trasferimento di carico cambia il carico sulle gomme, non il peso totale dell’auto',
      sections: [
        {
          heading: 'Le quattro impronte a terra',
          body: 'Un’auto da corsa tocca la pista attraverso quattro impronte delle gomme relativamente piccole. Ogni forza di frenata, accelerazione e percorrenza di curva passa, alla fine, da lì. Il pilota non crea grip girando il volante o premendo un pedale; chiede forze che le gomme possono produrre oppure no. Mescola, temperatura, pressione, asfalto e carico verticale influenzano tutti il risultato.',
        },
        {
          heading: 'Il trasferimento di carico',
          body: 'In frenata il carico si sposta verso l’asse anteriore; in accelerazione verso il posteriore; in curva verso le gomme esterne. È un trasferimento di carico dinamico, non uno spostamento reale della massa totale dell’auto. Più carico su una gomma di solito ne aumenta il grip assoluto, ma in genere meno che in proporzione, quindi grandi trasferimenti di carico possono ridurre il grip totale disponibile. Transizioni morbide rendono l’auto più facile da controllare.',
        },
        {
          heading: 'Grip meccanico e aerodinamico',
          body: 'Il grip meccanico viene da gomme, sospensioni, asfalto e carico. Il carico aerodinamico aumenta il carico verticale sulle gomme con la velocità, e per questo le curve veloci di solito sono diverse da quelle lente. Una GT3 può reggere una richiesta di sterzo o di frenata maggiore ad alta velocità, ma il carico aerodinamico diminuisce quando l’auto rallenta. Non dare mai per scontato che una tecnica efficace in una curva veloce funzioni allo stesso modo in un tornante.',
        },
        {
          heading: 'Applicazione alla guida',
          body: 'Affronta ogni curva con una sequenza chiara: frena finché l’auto è stabile, inserisci lo sterzo in modo progressivo, bilancia l’auto vicino al punto di corda e apri il volante gradualmente mentre acceleri. Usa un assetto ripetibile e gomme in condizioni costanti prima di giudicare se un problema di comportamento dipende dal pilota o dalla meccanica.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Fai cinque giri a un ritmo comodo concentrandoti solo su transizioni morbide tra freno, sterzo e acceleratore. Controlla se l’auto beccheggia o cambia direzione in modo brusco. Morbidezza non vuol dire lentezza: è il controllo preciso della velocità con cui cambiano le forze sulle gomme.',
        },
      ],
    },
    {
      id: 'traction-circle',
      title: 'Il cerchio di aderenza: capire i limiti del grip',
      summary: 'Frenare, accelerare e curvare condividono un unico budget di forza limitato.',
      figureTitle: 'Cerchio di aderenza: budget di forza combinato della gomma',
      sections: [
        {
          heading: 'Un budget di forza condiviso',
          body: 'Una gomma può generare forza longitudinale per frenare o accelerare e forza laterale per curvare. Queste richieste si contendono una capacità limitata. Il cerchio di aderenza è un modello mentale utile: se una gomma è vicina alla frenata massima in rettilineo, resta pochissima forza laterale disponibile. In pratica il limite spesso somiglia a un’ellisse e cambia con il carico, la velocità, l’asfalto e lo stato delle gomme.',
        },
        {
          heading: 'Combinare i comandi',
          body: 'Un pilota che entra in curva alla massima frenata deve ridurre la forza frenante man mano che cresce la richiesta di sterzo. Al punto di corda la richiesta laterale può essere alta e quella di acceleratore modesta. In uscita il pilota riduce gradualmente lo sterzo mentre aggiunge gas. Questo scambio coordinato di forze è l’abilità centrale della guida ad alte prestazioni.',
        },
        {
          heading: 'Cosa rappresenta lo schema',
          body: 'La figura usa assi di forza normalizzati; non è una mappa calibrata di una gomma specifica. I punti dentro il limite rappresentano combinazioni possibili; i punti oltre indicano scivolamento, bloccaggio delle ruote, intervento dell’ABS o del controllo di trazione, o una combinazione di questi. Il limite realmente disponibile è diverso per ogni ruota.',
        },
        {
          heading: 'Errore comune',
          kind: 'error',
          body: 'I principianti spesso chiedono nello stesso momento la massima pressione sul freno e un grande angolo di sterzo. Un altro errore comune è dare tutto gas prima di aver aperto abbastanza il volante. Entrambi sovraccaricano il budget di forza delle gomme. Il rimedio non è per forza un ritmo complessivo più lento: è un tempismo e un dosaggio migliori.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'In una curva a velocità media sempre uguale, frena forte in rettilineo, poi riduci volutamente la pressione man mano che aumenta lo sterzo. Ripeti con una piccola sovrapposizione controllata. Confronta la stabilità e la velocità minima, non solo quanto tardi riesci a frenare.',
        },
      ],
    },
    {
      id: 'racing-line',
      title: 'La traiettoria: geometria e velocità',
      summary: 'Esterno–interno–esterno, punti di riferimento e scelta del punto di corda.',
      figureTitle: 'Traiettorie diverse scambiano raggio d’ingresso con posizione in uscita',
      sections: [
        {
          heading: 'Parti da esterno–interno–esterno',
          body: 'Usare tutta la larghezza della pista può aumentare il raggio della curva e ridurre l’accelerazione laterale necessaria a una data velocità. La traiettoria base esterno–interno–esterno è un buon punto di partenza: arriva largo, sterza verso il punto di corda e lascia che l’auto si allarghi in uscita. La traiettoria ideale dipende dalla curva successiva, dal grip, dal traffico, dai cordoli e dall’auto.',
        },
        {
          heading: 'Punti di riferimento',
          body: 'Scegli un riferimento di frenata, un punto d’inserimento, un riferimento per il punto di corda e un obiettivo d’uscita. Un buon riferimento è fisso e visibile: un cartello, una giuntura dell’asfalto, l’inizio di un cordolo o una postazione dei commissari. Evita ombre e oggetti temporanei. Guarda verso il riferimento successivo prima di raggiungere quello attuale, invece di fissare il paraurti anteriore.',
        },
        {
          heading: 'Punto di corda anticipato e ritardato',
          body: 'Un punto di corda anticipato può costringere l’auto ad allargare in uscita e ritardare l’apertura del gas. Un punto di corda più ritardato spesso sacrifica un po’ di velocità d’ingresso per orientare meglio l’auto e accelerare meglio in uscita, soprattutto prima di un lungo rettilineo. Nessuno dei due è sempre più veloce. Il punto di corda geometrico è solo una geometria di partenza utile, non una regola.',
        },
        {
          heading: 'Sequenze di curve',
          body: 'La traiettoria più veloce in una curva può penalizzare quella dopo. In una sequenza sinistra-destra può convenire uscire dalla prima curva dal lato che prepara la seconda. Tratta le curve collegate come un unico problema di ottimizzazione, con particolare attenzione all’ultima uscita.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Scegli una curva e percorri tre traiettorie ripetibili: punto di corda leggermente anticipato, neutro e leggermente ritardato. Confronta il tempo sul tratto della curva e la velocità 100–200 metri dopo l’uscita. Rispetta i limiti della pista e fai cambiamenti abbastanza piccoli da poterli interpretare.',
        },
      ],
    },
    {
      id: 'braking',
      title: 'La frenata: dove il tempo sul giro si vince o si perde',
      summary: 'La frenata al limite, il rilascio e come misurare una zona di frenata.',
      figureTitle: 'Tracce illustrative della pressione sul freno',
      sections: [
        {
          heading: 'La frenata è una sequenza',
          body: 'Una zona di frenata di qualità comprende l’attacco iniziale del pedale, la decelerazione massima, un rilascio controllato e la transizione verso lo sterzo. Il punto di frenata giusto dipende dalla velocità d’arrivo, dalla pendenza, dal grip delle gomme, dal carico aerodinamico, dal carburante e dalla velocità d’ingresso necessaria. Frenare più tardi è più veloce solo se l’auto raggiunge comunque la giusta velocità e posizione d’inserimento.',
        },
        {
          heading: 'La frenata al limite',
          body: 'La frenata al limite punta a sfruttare il grip longitudinale disponibile senza bloccaggi incontrollati. Fai salire la pressione in fretta, ma in modo abbastanza progressivo da evitare un picco che destabilizza l’auto. Quando la velocità cala, il carico aerodinamico può diminuire e cambiare la pressione ammissibile. Su una GT3 con ABS possono esserci brevi interventi dell’ABS; un intervento forte e prolungato può indicare una richiesta eccessiva o un profilo di pressione sbagliato.',
        },
        {
          heading: 'Il rilascio conta',
          body: 'Rilasciare il pedale di colpo può cambiare il carico sull’anteriore e disturbare la transizione verso lo sterzo. Un rilascio controllato permette all’auto di ruotare in modo prevedibile. Molti piloti di livello intermedio guadagnano più tempo migliorando il rilascio del freno che spostando il punto di frenata di parecchi metri più avanti.',
        },
        {
          heading: 'Misurare la frenata',
          body: 'Usa pressione sul freno, velocità, accelerazione longitudinale e distanza. Confronta dove inizia la frenata, la pressione massima, quanto velocemente scende la velocità e dove la pressione torna a zero. Un punto di frenata ritardato con un punto di corda lento o un’uscita compromessa non è un miglioramento. Quando analizzi la telemetria, distingui la posizione del pedale dalla pressione reale sul freno.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Tieni fisso il riferimento di frenata per cinque giri. Migliora prima la forma della pressione e il rilascio. Poi sposta il riferimento a piccoli passi, controllando il punto di corda e la velocità d’uscita. Non sperimentare mai la frenata massima nel traffico o in un contesto non controllato.',
        },
      ],
    },
    {
      id: 'trail-braking',
      title: 'La frenata in inserimento: controllare la rotazione in ingresso',
      summary: 'Scambiare pressione sul freno con sterzo per gestire velocità d’ingresso e rotazione.',
      figureTitle: 'Frenata in inserimento: rilascia il freno mentre aumenta lo sterzo',
      sections: [
        {
          heading: 'Definizione',
          body: 'La frenata in inserimento (trail braking) significa mantenere una pressione sul freno decrescente oltre il punto d’inserimento. Invece di finire la frenata prima di sterzare, il pilota sovrappone le due cose, scambiando richiesta longitudinale sulle gomme con richiesta laterale. La tecnica può aiutare a gestire la velocità d’ingresso e a influenzare quanto facilmente l’auto ruota.',
        },
        {
          heading: 'Perché funziona',
          body: 'La decelerazione cambia il carico sulle gomme e le forze disponibili. Mantenere un po’ di pressione sul freno può conservare carico sull’anteriore, mentre le gomme posteriori possono avere meno riserva laterale, e questo influisce sulla risposta in imbardata. L’effetto esatto dipende dalla ripartizione di frenata, dal comportamento del differenziale, dalle caratteristiche delle gomme, dalla velocità e dall’assetto. La frenata in inserimento non garantisce più grip all’anteriore né una rotazione automatica.',
        },
        {
          heading: 'Il profilo di rilascio',
          body: 'Inizia con una fase di frenata stabile, quasi tutta in rettilineo. Man mano che aumenta lo sterzo, riduci la pressione sul freno in modo morbido. Evita di tenere la pressione massima fin dentro una curva stretta. L’obiettivo non è una quantità di sovrapposizione decisa in anticipo; è una transizione equilibrata e ripetibile che lascia all’auto seguire la traiettoria voluta.',
        },
        {
          heading: 'Quando non forzarla',
          body: 'Curve molto veloci, avvallamenti, dossi, condizioni di poco grip e un posteriore instabile possono richiedere un rilascio del freno anticipato o un approccio più prudente. Alcune curve si affrontano meglio con una frenata in rettilineo seguita da un inserimento pulito. Se il posteriore comincia a ruotare troppo in fretta, riduci la richiesta combinata e dai priorità alla stabilità dell’auto.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'In una curva a velocità media che perdona gli errori, confronta un rilascio pulito in rettilineo con un po’ di pressione mantenuta in inserimento. Analizza le tracce di freno e sterzo, la velocità minima, la risposta in imbardata e la qualità dell’uscita. Cambia una sola variabile alla volta.',
        },
      ],
    },
    {
      id: 'cornering',
      title: 'La tecnica in curva: ingresso, punto di corda e uscita',
      summary: 'Un’unica manovra continua: impostare l’auto, bilanciarla, aprire il volante.',
      figureTitle: 'Le fasi della curva e la zona di velocità minima',
      sections: [
        {
          heading: 'Ingresso: impostare l’auto',
          body: 'L’ingresso inizia prima del punto d’inserimento. Il pilota sceglie un punto di frenata, arriva a una velocità adeguata e posiziona l’auto per ottenere un raggio gestibile. Guardare lontano è essenziale: lo sguardo deve passare dal punto d’inserimento al punto di corda e poi all’uscita. Esagerare in ingresso di solito aumenta la richiesta di sterzo e può ritardare l’accelerazione.',
        },
        {
          heading: 'Centro curva: l’equilibrio',
          body: 'Vicino al punto di corda, sterzo e accelerazione laterale sono spesso elevati. Un’auto bilanciata può richiedere un filo di gas, un leggero alzo del piede o nessun gas, a seconda della curva e dell’assetto. L’obiettivo non è sempre massimizzare la velocità minima; è portare la velocità che dà il miglior tempo totale sul tratto.',
        },
        {
          heading: 'Uscita: aprire il volante',
          body: 'Quando l’auto ruota verso l’uscita, comincia a ridurre la richiesta di sterzo e ad aggiungere gas in modo progressivo. Il budget di forza delle gomme consente più accelerazione man mano che cala la richiesta laterale. L’allargamento in uscita deve essere voluto e prevedibile, non la conseguenza della fine del grip all’anteriore.',
        },
        {
          heading: 'Un modello mentale utile',
          body: 'Pensa alla curva come a un’unica manovra continua invece che a tre azioni separate. Un rilascio del freno tardivo o brusco influisce sull’equilibrio al punto di corda; la posizione al punto di corda decide quando si può aprire il volante; e questo decide quanto presto è disponibile tutta la potenza. Le fasi sono etichette per l’analisi, non confini netti nei comandi.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Individua quattro riferimenti in una sola curva: frenata, inserimento, punto di corda, uscita. Fai passare l’auto su ogni riferimento in modo costante prima di provare ad andare più forte. Rivedi il video o la telemetria per trovare la prima fase in cui compare un errore.',
        },
      ],
    },
    {
      id: 'exit-speed',
      title: 'La velocità d’uscita: trasformare buone curve in giri veloci',
      summary: 'Perché un vantaggio di velocità in uscita continua a pagare per tutto il rettilineo.',
      figureTitle: 'Il vantaggio di velocità in uscita si porta nel rettilineo',
      sections: [
        {
          heading: 'Perché le uscite contano',
          body: 'Un vantaggio di velocità in uscita resta per tutto il rettilineo successivo e può dare un guadagno di tempo ben oltre la curva stessa. Un pilota che arriva prima a gas pieno con l’auto meglio orientata continua a guadagnare distanza. L’effetto è particolarmente prezioso prima dei rettilinei lunghi, anche se il guadagno esatto dipende dall’accelerazione e dalla resistenza aerodinamica.',
        },
        {
          heading: 'Prima non è sempre meglio',
          body: 'Il primo istante di gas non coincide con un’accelerazione efficace. Aprire il gas troppo presto può causare pattinamento, interventi del controllo di trazione, sottosterzo in accelerazione o un’uscita più larga che costringe ad alzare il piede. La misura utile è quanta accelerazione ottieni mantenendo la traiettoria voluta.',
        },
        {
          heading: 'Scambiare l’ingresso con l’uscita',
          body: 'In una curva lenta che porta su un lungo rettilineo, un ingresso un po’ più lento o un punto di corda più ritardato può permettere di aprire prima il volante e accelerare più forte. Un pilota può perdere un po’ di tempo in ingresso e guadagnarne di più in uscita. Verificalo con il tempo del tratto e le tracce di velocità invece di dare per scontato che un punto di corda ritardato vinca sempre.',
        },
        {
          heading: 'Leggere le misure giuste',
          body: 'Confronta la velocità a un riferimento d’uscita fisso, la progressione dell’acceleratore, l’angolo di sterzo e la velocità 100 o 200 metri dopo. Quando possibile, confronta con la stessa marcia, lo stesso carico di carburante, lo stesso stato delle gomme e le stesse condizioni della pista. La velocità d’uscita a un riferimento preciso dice più di un picco di velocità isolato.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Scegli la curva lenta prima del rettilineo più lungo. Fai piccoli cambiamenti al tempismo del punto di corda e alla progressione del gas. Ordina i giri in base al tempo dal punto d’inserimento a un punto fisso ben dentro il rettilineo, non solo in base alla velocità al punto di corda.',
        },
      ],
    },
    {
      id: 'understeer-oversteer',
      title: 'Sottosterzo e sovrasterzo: capire la rotazione',
      summary: 'Riconoscere lo squilibrio in base alla fase della curva, e come reagire.',
      figureTitle: 'Confrontare l’imbardata richiede velocità, sterzo e contesto',
      sections: [
        {
          heading: 'Il sottosterzo',
          body: 'Il sottosterzo si ha quando l’auto gira meno di quanto richiesto: le gomme anteriori non riescono a dare abbastanza risposta laterale rispetto al posteriore. L’auto tende ad allargare più del previsto. Le cause possono essere una velocità d’ingresso eccessiva, uno sterzo brusco, la saturazione delle gomme anteriori in frenata o un’apertura del gas troppo anticipata con alcune trasmissioni.',
        },
        {
          heading: 'Il sovrasterzo',
          body: 'Il sovrasterzo si ha quando il posteriore ruota più del previsto rispetto all’anteriore. Può derivare da un rilascio brusco del gas, da una frenata in inserimento eccessiva, da un acceleratore aggressivo, dalla saturazione delle gomme posteriori o da un assetto che favorisce la rotazione. Una rotazione leggera e controllata può essere utile; un angolo di deriva posteriore che cresce e richiede molto controsterzo di solito è più lento e più rischioso.',
        },
        {
          heading: 'La fase della curva aiuta la diagnosi',
          body: 'Il sottosterzo in ingresso spesso rimanda alla velocità, alla frenata e all’inserimento. Il sottosterzo a centro curva può dipendere da traiettoria, equilibrio o grip delle gomme. Il sottosterzo in uscita può riflettere il tempismo del gas o un volante non abbastanza aperto. Il sovrasterzo in ingresso può nascere dal rilascio del freno o dalla stabilità del posteriore; il sovrasterzo in accelerazione si sviluppa di solito quando si dà gas. Sono indizi, non diagnosi definitive.',
        },
        {
          heading: 'Azioni correttive',
          body: 'In caso di sottosterzo, evita di aggiungere altro sterzo quando l’anteriore è già saturo; riduci la richiesta e lascia che le gomme ritrovino aderenza. In caso di sovrasterzo, reagisci subito con un controsterzo adeguato e pedali dosati, evitando correzioni brusche che innescano un effetto pendolo. Sulle auto reali il recupero va provato con un istruttore qualificato in un ambiente controllato.',
        },
        {
          heading: 'Interpretare la telemetria',
          body: 'Angolo di sterzo, velocità, velocità d’imbardata, accelerazione laterale, acceleratore e freno aiutano a individuare uno squilibrio probabile. Una velocità d’imbardata di riferimento semplificata è la velocità divisa per il raggio della traiettoria, ma il raggio non si ricava in modo affidabile dalla sola imbardata. Confrontare l’imbardata reale con un modello del veicolo basato su sterzo e velocità è utile solo se è calibrato per rapporto di sterzo, passo, comportamento delle gomme e convenzioni dei segni. Una differenza di velocità d’imbardata da sola non dimostra né sottosterzo né sovrasterzo.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Rivedi tre curve con un coach di guida o con un replay. Etichetta ogni evento di comportamento in base alla fase e alla causa probabile. Collega l’osservazione alle tracce dei pedali e dello sterzo prima di cambiare l’assetto.',
        },
      ],
    },
    {
      id: 'connecting-corners',
      title: 'Collegare le curve: ottimizzare una sequenza',
      summary: 'Un giro è una sequenza, non una raccolta di record curva per curva.',
      figureTitle: 'Chicane: dai priorità a dove finisce l’auto',
      sections: [
        {
          heading: 'Ottimizzare la sequenza',
          body: 'Un giro non è una raccolta di record indipendenti in ogni curva. L’uscita di una curva stabilisce le condizioni d’ingresso della successiva. In una chicane o in una serie di esse, un primo punto di corda troppo aggressivo può lasciare l’auto mal posizionata per l’ultima curva e per il rettilineo che segue.',
        },
        {
          heading: 'Priorità all’ultima uscita',
          body: 'Se l’ultima curva porta su un lungo rettilineo, ragiona a ritroso partendo dalla posizione e dall’orientamento ideali in uscita. Può servire una prima curva prudente, una traiettoria iniziale meno marcata o una transizione di sterzo anticipata. Il compromesso giusto dipende dalla distanza tra le curve, dalla velocità, dalla forma dei cordoli e dalla risposta dell’auto.',
        },
        {
          heading: 'Cambi di direzione',
          body: 'Le transizioni veloci richiedono una gestione precisa del carico. Un cambio di sterzo sinistra-destra brusco può creare un forte trasferimento di carico laterale e destabilizzare il posteriore. Uno sterzo morbido e deciso e un buon equilibrio del gas mantengono l’auto stabile riducendo la distanza inutile.',
        },
        {
          heading: 'Il traffico cambia la risposta',
          body: 'In gara la traiettoria più veloce da soli non è sempre disponibile. Difesa, sorpassi e ingressi compromessi richiedono priorità diverse. Lascia abbastanza margine per adattarti alle altre auto, soprattutto quando freni o curvi affiancato.',
        },
        {
          heading: 'Esercizio pratico',
          kind: 'drill',
          body: 'Confronta due traiettorie nello stesso complesso di due curve. Registra il tempo totale dal primo riferimento di frenata a un punto dopo l’ultima uscita. Non badare a quale singola curva sembra più veloce; giudica la sequenza completa.',
        },
      ],
    },
    {
      id: 'practice-and-telemetry',
      title: 'Mettere tutto insieme: allenamento e telemetria',
      summary: 'Prima la costanza, poi misura, cambia una cosa sola e ripeti.',
      figureTitle: 'Le tracce sovrapposte mostrano dove nascono le differenze di velocità',
      sections: [
        {
          heading: 'La costanza prima dell’attacco massimo',
          body: 'Un pilota non può riconoscere in modo affidabile un miglioramento se la variazione da un giro all’altro è più grande del cambiamento di tecnica che sta provando. Parti da una base stabile: stessa auto, stessa configurazione del circuito, stesse condizioni delle gomme e stesso carburante, per quanto possibile. Fai giri ripetibili a un ritmo che ti lasci abbastanza attenzione per osservare cosa fa l’auto.',
        },
        {
          heading: 'Una gerarchia utile per la telemetria',
          body: 'Parti dalla velocità in funzione della distanza, perché mostra dove si perde tempo. Poi esamina la pressione sul freno e il rilascio, la riapertura del gas e la sua progressione, la richiesta di sterzo e le accelerazioni disponibili. Sovrapponi giri confrontabili allineati sulla distanza. Il riferimento di frenata di un pilota più veloce non è per forza l’obiettivo giusto se la sua traiettoria o la sua velocità d’ingresso sono diverse.',
        },
        {
          heading: 'Misurare il risultato completo',
          body: 'Le misure utili in curva sono la velocità d’ingresso, l’inizio della frenata, la pressione massima sul freno, la distanza di rilascio del freno, la velocità minima, la riapertura del gas, il punto di gas pieno, la velocità d’uscita e il tempo totale del tratto. La distanza percorsa senza pedali e la sovrapposizione freno/gas danno contesto, ma nessuna delle due è negativa di per sé: un breve tratto senza pedali o una piccola sovrapposizione possono andare bene per una certa auto e una certa curva.',
        },
        {
          heading: 'Un ciclo di miglioramento ripetibile',
          body: 'Osserva un problema ricorrente; formula un’ipotesi; scegli un solo cambiamento nei comandi; fai diversi giri costanti; confronta la curva completa e il rettilineo che segue; tieni o scarta il cambiamento. Evita di cambiare insieme assetto, riferimento di frenata, punto di corda e strategia del gas, perché il risultato diventa difficile da interpretare.',
        },
        {
          heading: 'Piano di crescita in quattro sessioni',
          body: 'Sessione 1: impara i riferimenti e ripeti una traiettoria stabile.\nSessione 2: affina la pressione sul freno e il rilascio.\nSessione 3: migliora la posizione al punto di corda e l’accelerazione in uscita.\nSessione 4: analizza la telemetria e concentrati sulle due curve in cui perdi più tempo in modo ripetuto.\nRipeti il ciclo man mano che conosci meglio il circuito.',
        },
        {
          heading: 'Principio finale',
          kind: 'principle',
          body: 'La velocità è il risultato di un uso efficiente del grip disponibile, di un posizionamento preciso dell’auto e di comandi che preparano ciascuno la fase successiva del giro. Guida con intenzione, misura il risultato e cambia una cosa alla volta.',
        },
      ],
    },
  ],
  figures: {
    front: 'ANTERIORE',
    rear: 'POSTERIORE',
    brakingLoad: 'Frenata: carico verso l’anteriore',
    acceleratingLoad: 'Accelerazione: carico verso il posteriore',
    corneringLoad: ['In curva: carico', 'verso le gomme esterne'],
    accelerating: 'ACCELERAZIONE',
    braking: 'FRENATA',
    turning: 'CURVA',
    tireLimit: 'Limite di forza della gomma (normalizzato)',
    trailPath: 'Percorso illustrativo della frenata in inserimento',
    progressThroughCorner: 'Avanzamento nella curva',
    lateralPosition: 'Posizione laterale (schema)',
    geometricApex: 'Punto di corda geometrico',
    geometricArc: 'Arco geometrico',
    laterApexPath: 'Traiettoria con punto di corda ritardato',
    brakingZoneDistance: 'Distanza nella zona di frenata (normalizzata)',
    brakeCommand: 'Comando del freno (%)',
    plannedThreshold: 'Frenata al limite pianificata',
    lateAbrupt: 'Frenata tardiva e brusca',
    cornerEntryProgression: 'Progressione in ingresso curva',
    normalizedInput: 'Comando normalizzato',
    brakePressure: 'Pressione sul freno (%)',
    steeringDemand: 'Richiesta di sterzo (relativa)',
    illustrativeSpeed: 'Velocità (km/h illustrativi)',
    entry: 'Ingresso',
    apex: 'Punto di corda',
    exit: 'Uscita',
    speed: 'Velocità',
    distanceAfterCorner: 'Distanza dopo la curva (m)',
    speedKmh: 'Velocità (km/h)',
    driverA: 'Pilota A: uscita più lenta',
    driverB: 'Pilota B: +5 km/h in uscita',
    cornerProgression: 'Avanzamento nella curva',
    yawRate: 'Velocità d’imbardata (schema)',
    referenceYaw: 'Risposta in imbardata di riferimento',
    underRotation: 'Rotazione insufficiente (possibile sottosterzo)',
    overRotation: 'Rotazione eccessiva (possibile sovrasterzo)',
    twoCornerProgress: 'Avanzamento nel complesso di due curve',
    balancedPath: 'Traiettoria equilibrata che privilegia l’ultima uscita',
    alternativePath: 'Traiettoria alternativa',
    normalizedCornerDistance: 'Distanza normalizzata nella curva',
    currentLap: 'Giro attuale',
    referenceLap: 'Giro di riferimento',
  },
};
