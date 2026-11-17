// The Learning page's guide in French (the English original and the types are in learningGuide.ts)

import type { Guide } from '@/lib/learningGuide';

export const FR: Guide = {
  title: 'L’art de piloter une voiture de course',
  subtitle: 'Un guide pratique et illustré pour les pilotes débutants et intermédiaires',
  topics: ['Dynamique du véhicule', 'Trajectoire', 'Freinage', 'Freinage dégressif', 'Rotation', 'Télémétrie'],
  note: 'Conçu pour le sport automobile sur circuit fermé et les simulateurs de course, avec des exemples en GT3. Dans de vraies voitures, les techniques doivent être travaillées progressivement et sous la supervision d’instructeurs qualifiés.',
  chapters: [
    {
      id: 'race-car-dynamics',
      title: 'Comprendre la dynamique d’une voiture de course',
      summary: 'Quatre surfaces de contact, le transfert de charge et l’origine de l’adhérence.',
      figureTitle: 'Le transfert de charge change la charge des pneus, pas le poids total de la voiture',
      sections: [
        {
          heading: 'Les quatre surfaces de contact',
          body: 'Une voiture de course est en contact avec la piste par quatre surfaces de contact relativement petites. Toutes les forces de freinage, d’accélération et de virage passent finalement par elles. Le pilote ne crée pas d’adhérence en tournant le volant ou en appuyant sur une pédale ; il demande des forces que les pneus peuvent produire, ou pas. La gomme, la température, la pression, le revêtement et la charge verticale influencent tous le résultat.',
        },
        {
          heading: 'Le transfert de charge',
          body: 'Au freinage, la charge se transfère vers l’essieu avant ; à l’accélération, vers l’arrière ; en virage, vers les pneus extérieurs. C’est un transfert de charge dynamique, pas un déplacement réel de la masse totale de la voiture. Plus de charge sur un pneu augmente en général son adhérence absolue, mais le plus souvent de façon moins que proportionnelle, si bien que de grands transferts de charge peuvent réduire l’adhérence totale disponible. Des transitions douces rendent la voiture plus facile à contrôler.',
        },
        {
          heading: 'Adhérence mécanique et aérodynamique',
          body: 'L’adhérence mécanique vient des pneus, des suspensions, du revêtement et de la charge. L’appui aérodynamique augmente la charge verticale sur les pneus avec la vitesse, ce qui rend généralement les virages rapides différents des virages lents. Une GT3 peut accepter une demande de braquage ou de freinage plus forte à haute vitesse, mais l’appui diminue quand la voiture ralentit. Ne pars jamais du principe qu’une technique efficace dans une courbe rapide fonctionnera de la même manière dans une épingle.',
        },
        {
          heading: 'Application au pilotage',
          body: 'Aborde chaque virage avec une séquence claire : freine tant que la voiture est stable, introduis progressivement le braquage, équilibre la voiture près du point de corde et ouvre progressivement le volant en accélérant. Utilise un setup reproductible et des pneus dans un état constant avant de juger si un problème de comportement vient du pilote ou de la mécanique.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Fais cinq tours à un rythme confortable en te concentrant uniquement sur des transitions douces entre le freinage, le braquage et l’accélérateur. Regarde si la voiture plonge ou change de direction brusquement. La douceur n’est pas la lenteur : c’est le contrôle précis de la vitesse à laquelle les forces des pneus changent.',
        },
      ],
    },
    {
      id: 'traction-circle',
      title: 'Le cercle d’adhérence : comprendre les limites du grip',
      summary: 'Freiner, accélérer et tourner se partagent un même budget de force limité.',
      figureTitle: 'Cercle d’adhérence : budget de force combiné du pneu',
      sections: [
        {
          heading: 'Un budget de force partagé',
          body: 'Un pneu peut produire une force longitudinale pour freiner ou accélérer et une force latérale pour tourner. Ces demandes se disputent une capacité limitée. Le cercle d’adhérence est un modèle mental utile : si un pneu est proche du freinage maximal en ligne droite, il ne reste presque plus de force latérale disponible. En pratique, la limite ressemble souvent à une ellipse et change avec la charge, la vitesse, le revêtement et l’état des pneus.',
        },
        {
          heading: 'Combiner les commandes',
          body: 'Un pilote qui entre dans un virage au freinage maximal doit réduire la force de freinage à mesure que la demande de braquage augmente. Au point de corde, la demande latérale peut être élevée et la demande d’accélérateur modeste. En sortie, le pilote réduit progressivement le braquage tout en remettant les gaz. Cet échange coordonné de forces est la compétence centrale du pilotage de performance.',
        },
        {
          heading: 'Ce que montre le schéma',
          body: 'La figure utilise des axes de force normalisés ; ce n’est pas une carte calibrée d’un pneu en particulier. Les points à l’intérieur de la limite représentent des combinaisons possibles ; les points au-delà signifient une glisse, un blocage de roue, une intervention de l’ABS ou de l’antipatinage, ou une combinaison de tout cela. La limite réellement disponible est différente à chaque roue.',
        },
        {
          heading: 'Erreur fréquente',
          kind: 'error',
          body: 'Les débutants demandent souvent en même temps la pression de freinage maximale et un grand angle de braquage. Une autre erreur fréquente consiste à mettre plein gaz avant d’avoir suffisamment ouvert le volant. Les deux surchargent le budget de force des pneus. Le remède n’est pas forcément un rythme global plus lent : c’est un meilleur timing et un meilleur dosage.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Dans un virage à vitesse moyenne toujours identique, freine fort en ligne droite, puis relâche volontairement la pression à mesure que le braquage augmente. Recommence avec un petit chevauchement contrôlé. Compare la stabilité et la vitesse minimale, pas seulement à quel point tu peux freiner tard.',
        },
      ],
    },
    {
      id: 'racing-line',
      title: 'La trajectoire : géométrie et vitesse',
      summary: 'Extérieur–intérieur–extérieur, points de repère et choix du point de corde.',
      figureTitle: 'Chaque trajectoire échange rayon d’entrée contre position de sortie',
      sections: [
        {
          heading: 'Commence par extérieur–intérieur–extérieur',
          body: 'Utiliser toute la largeur de la piste peut augmenter le rayon du virage et réduire l’accélération latérale nécessaire à une vitesse donnée. La trajectoire de base extérieur–intérieur–extérieur est un bon point de départ : arrive large, tourne vers le point de corde et laisse la voiture s’écarter vers l’extérieur en sortie. La trajectoire idéale dépend du virage suivant, de l’adhérence, du trafic, des vibreurs et de la voiture.',
        },
        {
          heading: 'Points de repère',
          body: 'Choisis un repère de freinage, un point de braquage, un repère de point de corde et une cible de sortie. Un bon repère est fixe et visible : un panneau, un joint de bitume, le début d’un vibreur ou un poste de commissaire. Évite les ombres et les objets temporaires. Regarde vers le repère suivant avant d’atteindre le repère actuel, plutôt que de fixer le pare-chocs avant.',
        },
        {
          heading: 'Point de corde précoce ou tardif',
          body: 'Un point de corde précoce peut obliger la voiture à s’élargir en sortie et retarder la remise des gaz. Un point de corde plus tardif sacrifie souvent un peu de vitesse d’entrée pour mieux orienter la voiture et mieux accélérer en sortie, surtout avant une longue ligne droite. Aucun des deux n’est toujours plus rapide. Le point de corde géométrique est simplement une géométrie de départ utile, pas une règle.',
        },
        {
          heading: 'Enchaînements de virages',
          body: 'La trajectoire la plus rapide dans un virage peut pénaliser le suivant. Dans un enchaînement gauche-droite, il peut être avantageux de sortir du premier virage du côté qui prépare le second. Traite les virages enchaînés comme un seul problème d’optimisation, en portant une attention particulière à la dernière sortie.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Choisis un virage et roule trois trajectoires reproductibles : point de corde légèrement précoce, neutre et légèrement tardif. Compare le temps sur le segment du virage et la vitesse 100 à 200 mètres après la sortie. Respecte les limites de piste et fais des changements assez petits pour pouvoir les interpréter.',
        },
      ],
    },
    {
      id: 'braking',
      title: 'Le freinage : là où le temps au tour se gagne ou se perd',
      summary: 'Le freinage au seuil, le relâchement et comment mesurer une zone de freinage.',
      figureTitle: 'Courbes de pression de freinage illustratives',
      sections: [
        {
          heading: 'Le freinage est une séquence',
          body: 'Une bonne zone de freinage comprend l’attaque initiale de la pédale, la décélération maximale, un relâchement contrôlé et la transition vers le braquage. Le bon point de freinage dépend de la vitesse d’arrivée, de la pente, de l’adhérence des pneus, de l’appui, du carburant et de la vitesse d’entrée nécessaire. Freiner plus tard n’est plus rapide que si la voiture atteint quand même la bonne vitesse et la bonne position au point de braquage.',
        },
        {
          heading: 'Le freinage au seuil',
          body: 'Le freinage au seuil vise à utiliser l’adhérence longitudinale disponible sans blocage incontrôlé. Monte la pression rapidement, mais assez progressivement pour éviter un pic qui déstabilise la voiture. À mesure que la vitesse baisse, la charge aérodynamique peut diminuer, ce qui change la pression admissible. Sur une GT3 équipée de l’ABS, de brèves interventions de l’ABS sont possibles ; une intervention forte et prolongée peut indiquer une demande excessive ou un mauvais profil de pression.',
        },
        {
          heading: 'Le relâchement compte',
          body: 'Relâcher brusquement la pédale peut changer la charge sur l’avant et perturber la transition vers le braquage. Un relâchement contrôlé permet à la voiture de pivoter de façon prévisible. Beaucoup de pilotes intermédiaires gagnent plus de temps en améliorant leur relâchement du frein qu’en reculant leur point de freinage de plusieurs mètres.',
        },
        {
          heading: 'Mesurer le freinage',
          body: 'Utilise la pression de freinage, la vitesse, l’accélération longitudinale et la distance. Compare où commence le freinage, la pression maximale, la vitesse à laquelle la voiture ralentit et l’endroit où la pression revient à zéro. Un point de freinage tardif avec un point de corde lent ou une sortie compromise n’est pas une amélioration. Distingue la position de la pédale de la pression de freinage réelle quand tu analyses la télémétrie.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Garde le même repère de freinage pendant cinq tours. Améliore d’abord la forme de la pression et le relâchement. Ajuste ensuite le repère par petites étapes en vérifiant le point de corde et la vitesse de sortie. N’expérimente jamais le freinage maximal dans le trafic ou dans un cadre non contrôlé.',
        },
      ],
    },
    {
      id: 'trail-braking',
      title: 'Le freinage dégressif : contrôler la rotation en entrée de virage',
      summary: 'Échanger la pression de freinage contre du braquage pour gérer la vitesse d’entrée et la rotation.',
      figureTitle: 'Freinage dégressif : relâcher le frein à mesure que le braquage augmente',
      sections: [
        {
          heading: 'Définition',
          body: 'Le freinage dégressif consiste à garder une pression de freinage décroissante au-delà du point de braquage. Au lieu de terminer le freinage avant de tourner, le pilote superpose les deux en échangeant la demande longitudinale sur les pneus contre une demande latérale. Cette technique peut aider à gérer la vitesse d’entrée et à influencer la facilité avec laquelle la voiture pivote.',
        },
        {
          heading: 'Pourquoi ça marche',
          body: 'La décélération change la charge des pneus et les forces disponibles. Garder un peu de pression de freinage peut maintenir de la charge sur l’avant, tandis que les pneus arrière ont parfois moins de réserve latérale, ce qui influence la réponse en lacet. L’effet exact dépend de la répartition de freinage, du comportement du différentiel, des caractéristiques des pneus, de la vitesse et du setup. Le freinage dégressif ne garantit ni plus d’adhérence à l’avant ni une rotation automatique.',
        },
        {
          heading: 'Le profil de relâchement',
          body: 'Commence par une phase de freinage stable, essentiellement en ligne droite. À mesure que le braquage augmente, diminue la pression de freinage en douceur. Évite de garder la pression maximale loin dans un virage serré. Le but n’est pas une quantité de chevauchement fixée à l’avance ; c’est une transition équilibrée et reproductible qui permet à la voiture de suivre la trajectoire voulue.',
        },
        {
          heading: 'Quand ne pas le forcer',
          body: 'Les virages très rapides, les bosses, les sommets de côte, la faible adhérence et un arrière instable peuvent demander un relâchement du frein plus précoce ou une approche plus prudente. Certains virages se négocient mieux avec un freinage en ligne droite suivi d’un braquage propre. Si l’arrière commence à pivoter trop vite, réduis la demande combinée et donne la priorité à la stabilisation de la voiture.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Dans un virage à vitesse moyenne qui pardonne, compare un relâchement propre en ligne droite avec un peu de pression dégressive. Analyse les courbes de frein et de braquage, la vitesse minimale, la réponse en lacet et la qualité de la sortie. Ne change qu’une seule variable à la fois.',
        },
      ],
    },
    {
      id: 'cornering',
      title: 'La technique en virage : entrée, point de corde et sortie',
      summary: 'Une seule manœuvre continue : installer la voiture, l’équilibrer, ouvrir le volant.',
      figureTitle: 'Les phases du virage et la zone de vitesse minimale',
      sections: [
        {
          heading: 'Entrée : installer la voiture',
          body: 'L’entrée commence avant le point de braquage. Le pilote choisit un point de freinage, arrive à une vitesse adaptée et place la voiture pour obtenir un rayon gérable. Regarder loin est essentiel : le regard doit passer du point de braquage au point de corde, puis à la sortie. Arriver trop vite augmente généralement la demande de braquage et peut retarder l’accélération.',
        },
        {
          heading: 'Milieu de virage : l’équilibre',
          body: 'Près du point de corde, le braquage et l’accélération latérale sont souvent importants. Une voiture équilibrée peut demander un filet de gaz, un léger lever de pied ou aucun gaz selon le virage et le setup. L’objectif n’est pas toujours de maximiser la vitesse minimale ; c’est de garder la vitesse qui donne le meilleur temps total sur le segment.',
        },
        {
          heading: 'Sortie : ouvrir le volant',
          body: 'Quand la voiture pivote vers la sortie, commence à réduire la demande de braquage et à remettre progressivement les gaz. Le budget de force des pneus permet plus d’accélération à mesure que la demande latérale diminue. L’élargissement en sortie doit être volontaire et prévisible, pas la conséquence d’un manque d’adhérence à l’avant.',
        },
        {
          heading: 'Un modèle mental utile',
          body: 'Vois le virage comme une seule manœuvre continue plutôt que trois actions séparées. Un relâchement du frein tardif ou brusque affecte l’équilibre au point de corde ; la position au point de corde détermine quand le volant peut être ouvert ; cela détermine à quel moment la pleine puissance devient disponible. Les phases sont des étiquettes pour l’analyse, pas des frontières brutales dans le pilotage.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Identifie quatre repères dans un même virage : freinage, braquage, point de corde, sortie. Fais passer la voiture sur chaque repère de façon régulière avant d’essayer d’aller plus vite. Analyse la vidéo ou la télémétrie pour trouver la première phase où une erreur apparaît.',
        },
      ],
    },
    {
      id: 'exit-speed',
      title: 'La vitesse de sortie : transformer de bons virages en tours rapides',
      summary: 'Pourquoi un avantage de vitesse en sortie rapporte jusqu’au bout de la ligne droite.',
      figureTitle: 'L’avantage de vitesse en sortie se prolonge dans la ligne droite',
      sections: [
        {
          heading: 'Pourquoi les sorties comptent',
          body: 'Un avantage de vitesse en sortie se prolonge dans la ligne droite suivante et peut faire gagner du temps bien au-delà du virage lui-même. Un pilote qui atteint le plein gaz plus tôt avec une voiture mieux orientée continue de prendre de la distance. L’effet est particulièrement précieux avant les longues lignes droites, même si le gain de temps exact dépend de l’accélération et de la traînée.',
        },
        {
          heading: 'Plus tôt n’est pas toujours mieux',
          body: 'Le premier instant d’accélérateur n’est pas la même chose qu’une accélération efficace. Remettre les gaz trop tôt peut provoquer du patinage, une intervention de l’antipatinage, du sous-virage à l’accélération ou une sortie plus large qui oblige à lever le pied. La bonne mesure est la quantité d’accélération obtenue tout en gardant la trajectoire voulue.',
        },
        {
          heading: 'Échanger l’entrée contre la sortie',
          body: 'Dans un virage lent qui débouche sur une longue ligne droite, une entrée un peu plus lente ou un point de corde plus tardif peut permettre d’ouvrir le volant plus tôt et d’accélérer plus fort. Un pilote peut perdre un peu de temps à l’entrée et en gagner davantage en sortie. Vérifie-le avec le temps du segment et les courbes de vitesse plutôt que de supposer qu’un point de corde tardif gagne toujours.',
        },
        {
          heading: 'Lire les bonnes mesures',
          body: 'Compare la vitesse à un repère de sortie fixe, la progressivité de l’accélérateur, l’angle de braquage et la vitesse 100 ou 200 mètres plus loin. Quand c’est possible, compare avec le même rapport, la même charge de carburant, le même état des pneus et les mêmes conditions de piste. La vitesse de sortie à un repère précis a plus de sens qu’une vitesse de pointe isolée.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Choisis le virage lent avant la plus longue ligne droite. Fais de petits changements sur le timing du point de corde et la progressivité de l’accélérateur. Classe les tours selon le temps entre le point de braquage et un point fixe loin dans la ligne droite, pas seulement selon la vitesse au point de corde.',
        },
      ],
    },
    {
      id: 'understeer-oversteer',
      title: 'Sous-virage et survirage : comprendre la rotation',
      summary: 'Reconnaître le déséquilibre selon la phase du virage, et comment réagir.',
      figureTitle: 'Comparer le lacet demande la vitesse, le braquage et le contexte',
      sections: [
        {
          heading: 'Le sous-virage',
          body: 'Le sous-virage se produit quand la voiture tourne moins que ce qui est demandé : les pneus avant ne peuvent pas fournir assez de réponse latérale par rapport à l’arrière. La voiture a tendance à s’élargir plus que prévu. Les causes peuvent être une vitesse d’entrée excessive, un braquage brusque, la saturation des pneus avant au freinage ou une remise des gaz trop précoce avec certaines transmissions.',
        },
        {
          heading: 'Le survirage',
          body: 'Le survirage se produit quand l’arrière pivote plus que prévu par rapport à l’avant. Il peut venir d’un lever de pied brusque, d’un freinage dégressif excessif, d’une accélération agressive, de la saturation des pneus arrière ou d’un setup qui favorise la rotation. Une rotation légère et contrôlée peut être utile ; un angle de dérive arrière qui grandit et demande beaucoup de contre-braquage est en général plus lent et plus risqué.',
        },
        {
          heading: 'La phase du virage oriente le diagnostic',
          body: 'Le sous-virage à l’entrée renvoie souvent à la vitesse, au freinage et au point de braquage. Le sous-virage en milieu de virage peut venir de la trajectoire, de l’équilibre ou de l’adhérence des pneus. Le sous-virage en sortie peut refléter le timing de l’accélérateur ou un volant pas assez ouvert. Le survirage à l’entrée peut venir du relâchement du frein ou de la stabilité de l’arrière ; le survirage à l’accélération se développe en général pendant la remise des gaz. Ce sont des indices, pas des diagnostics définitifs.',
        },
        {
          heading: 'Actions correctives',
          body: 'En cas de sous-virage, évite d’ajouter du braquage une fois l’avant saturé ; réduis la demande et laisse les pneus retrouver de l’adhérence. En cas de survirage, réagis rapidement avec un contre-braquage adapté et des pédales dosées, en évitant les corrections brusques qui déclenchent un effet de balancier. Dans une vraie voiture, la récupération doit être travaillée avec un instructeur qualifié dans un environnement contrôlé.',
        },
        {
          heading: 'Interpréter la télémétrie',
          body: 'L’angle de braquage, la vitesse, la vitesse de lacet, l’accélération latérale, l’accélérateur et le frein aident à repérer un déséquilibre probable. Une vitesse de lacet de référence simplifiée est la vitesse divisée par le rayon de la trajectoire, mais le rayon ne se déduit pas de façon fiable du lacet seul. Comparer le lacet réel à un modèle du véhicule basé sur le braquage et la vitesse n’est utile que s’il est calibré pour le rapport de direction, l’empattement, le comportement des pneus et les conventions de signe. Un écart de vitesse de lacet seul ne prouve ni sous-virage ni survirage.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Revois trois virages avec un coach de pilotage ou un replay. Étiquette chaque événement de comportement selon sa phase et sa cause probable. Mets l’observation en relation avec les courbes des pédales et du braquage avant de changer le setup.',
        },
      ],
    },
    {
      id: 'connecting-corners',
      title: 'Enchaîner les virages : optimiser une séquence',
      summary: 'Un tour est une séquence, pas une collection de records virage par virage.',
      figureTitle: 'Chicane : donne la priorité à l’endroit où finit la voiture',
      sections: [
        {
          heading: 'Optimiser la séquence',
          body: 'Un tour n’est pas une collection de records indépendants dans chaque virage. La sortie d’un virage fixe les conditions d’entrée du suivant. Dans une chicane ou une série de « S », un premier point de corde trop agressif peut laisser la voiture mal placée pour le dernier virage et la ligne droite suivante.',
        },
        {
          heading: 'Priorité à la dernière sortie',
          body: 'Si le dernier virage débouche sur une longue ligne droite, raisonne à rebours depuis la position et l’orientation idéales en sortie. Cela peut demander un premier virage prudent, une trajectoire initiale moins marquée ou une transition de braquage plus précoce. Le bon compromis dépend de l’espacement, de la vitesse, de la forme des vibreurs et de la réponse de la voiture.',
        },
        {
          heading: 'Changements de direction',
          body: 'Les transitions rapides demandent une gestion précise de la charge. Un changement de braquage gauche-droite brusque peut créer un fort transfert de charge latéral et déstabiliser l’arrière. Un braquage doux et décidé et un bon équilibre à l’accélérateur gardent la voiture stable tout en limitant la distance inutile.',
        },
        {
          heading: 'Le trafic change la réponse',
          body: 'En course, la trajectoire la plus rapide en solo n’est pas toujours disponible. La défense, les dépassements et les entrées compromises demandent d’autres priorités. Garde assez de marge pour t’adapter aux autres voitures, surtout en freinant ou en tournant côte à côte.',
        },
        {
          heading: 'Exercice pratique',
          kind: 'drill',
          body: 'Compare deux trajectoires dans un même enchaînement de deux virages. Note le temps total entre le premier repère de freinage et un point après la dernière sortie. Ignore quel virage semble le plus rapide pris isolément ; juge la séquence complète.',
        },
      ],
    },
    {
      id: 'practice-and-telemetry',
      title: 'Tout assembler : entraînement et télémétrie',
      summary: 'D’abord la régularité, puis mesurer, changer une seule chose et recommencer.',
      figureTitle: 'Les courbes superposées montrent où naissent les écarts de vitesse',
      sections: [
        {
          heading: 'La régularité avant l’attaque maximale',
          body: 'Un pilote ne peut pas repérer de façon fiable une amélioration si la variation d’un tour à l’autre est plus grande que le changement de technique testé. Commence par une base stable : même voiture, même configuration de circuit, mêmes conditions de pneus et même hypothèse de carburant dans la mesure du possible. Roule des tours reproductibles à un rythme qui te laisse assez d’attention pour observer ce que fait la voiture.',
        },
        {
          heading: 'Une hiérarchie utile pour la télémétrie',
          body: 'Commence par la vitesse en fonction de la distance, car elle montre où le temps se perd. Examine ensuite la pression de freinage et son relâchement, la remise des gaz et sa progressivité, la demande de braquage et les accélérations disponibles. Superpose des tours comparables alignés sur la distance. Le repère de freinage d’un pilote plus rapide n’est pas forcément la bonne cible si sa trajectoire ou sa vitesse d’entrée sont différentes.',
        },
        {
          heading: 'Mesurer le résultat complet',
          body: 'Les mesures utiles dans un virage sont la vitesse d’entrée, le début du freinage, la pression de freinage maximale, la distance de relâchement du frein, la vitesse minimale, la remise des gaz, le point de plein gaz, la vitesse de sortie et le temps total du segment. La distance en roue libre et le chevauchement frein/accélérateur donnent du contexte, mais aucun n’est mauvais en soi : une brève roue libre ou un léger chevauchement peuvent convenir à une voiture et à un virage précis.',
        },
        {
          heading: 'Une boucle d’amélioration reproductible',
          body: 'Observe un problème récurrent ; formule une hypothèse ; choisis un seul changement de commande ; roule plusieurs tours réguliers ; compare le virage complet et la ligne droite qui suit ; garde ou rejette le changement. Évite de changer en même temps le setup, le repère de freinage, le point de corde et la stratégie d’accélérateur, car le résultat devient difficile à interpréter.',
        },
        {
          heading: 'Plan de progression en quatre sessions',
          body: 'Session 1 : apprends les repères et répète une trajectoire stable.\nSession 2 : affine la pression de freinage et le relâchement.\nSession 3 : améliore le placement au point de corde et l’accélération en sortie.\nSession 4 : analyse la télémétrie et concentre-toi sur les deux virages où tu perds le plus de temps de façon répétée.\nRecommence le cycle à mesure que tu connais mieux le circuit.',
        },
        {
          heading: 'Principe final',
          kind: 'principle',
          body: 'La vitesse est le résultat d’une utilisation efficace de l’adhérence disponible, d’un placement précis de la voiture et de commandes qui préparent chacune la phase suivante du tour. Pilote avec intention, mesure le résultat et change une seule chose à la fois.',
        },
      ],
    },
  ],
  figures: {
    front: 'AVANT',
    rear: 'ARRIÈRE',
    brakingLoad: 'Freinage : charge vers l’avant',
    acceleratingLoad: 'Accélération : charge vers l’arrière',
    corneringLoad: ['Virage : charge', 'vers les pneus extérieurs'],
    accelerating: 'ACCÉLÉRATION',
    braking: 'FREINAGE',
    turning: 'VIRAGE',
    tireLimit: 'Limite de force du pneu (normalisée)',
    trailPath: 'Trajet illustratif du freinage dégressif',
    progressThroughCorner: 'Progression dans le virage',
    lateralPosition: 'Position latérale (schéma)',
    geometricApex: 'Point de corde géométrique',
    geometricArc: 'Arc géométrique',
    laterApexPath: 'Trajectoire à point de corde tardif',
    brakingZoneDistance: 'Distance dans la zone de freinage (normalisée)',
    brakeCommand: 'Commande de frein (%)',
    plannedThreshold: 'Freinage au seuil planifié',
    lateAbrupt: 'Freinage tardif et brusque',
    cornerEntryProgression: 'Progression en entrée de virage',
    normalizedInput: 'Commande normalisée',
    brakePressure: 'Pression de freinage (%)',
    steeringDemand: 'Demande de braquage (relative)',
    illustrativeSpeed: 'Vitesse (km/h illustratifs)',
    entry: 'Entrée',
    apex: 'Point de corde',
    exit: 'Sortie',
    speed: 'Vitesse',
    distanceAfterCorner: 'Distance après le virage (m)',
    speedKmh: 'Vitesse (km/h)',
    driverA: 'Pilote A : sortie plus lente',
    driverB: 'Pilote B : +5 km/h en sortie',
    cornerProgression: 'Progression dans le virage',
    yawRate: 'Vitesse de lacet (schéma)',
    referenceYaw: 'Réponse en lacet de référence',
    underRotation: 'Rotation insuffisante (sous-virage possible)',
    overRotation: 'Rotation excessive (survirage possible)',
    twoCornerProgress: 'Progression dans l’enchaînement de deux virages',
    balancedPath: 'Trajectoire équilibrée qui privilégie la dernière sortie',
    alternativePath: 'Trajectoire alternative',
    normalizedCornerDistance: 'Distance normalisée dans le virage',
    currentLap: 'Tour actuel',
    referenceLap: 'Tour de référence',
  },
};
