// The Learning page's guide in German (the English original and the types are in learningGuide.ts)

import type { Guide } from '@/lib/learningGuide';

export const DE: Guide = {
  title: 'Die Kunst, einen Rennwagen zu fahren',
  subtitle: 'Ein praktischer, illustrierter Leitfaden für Einsteiger und fortgeschrittene Fahrer',
  topics: ['Fahrdynamik', 'Ideallinie', 'Bremsen', 'Trail-Braking', 'Rotation', 'Telemetrie'],
  note: 'Entwickelt für den Motorsport auf abgesperrten Strecken und für Rennsimulatoren, mit Beispielen aus dem GT3. In echten Fahrzeugen sollten die Techniken schrittweise und unter qualifizierter Aufsicht geübt werden.',
  chapters: [
    {
      id: 'race-car-dynamics',
      title: 'Die Dynamik eines Rennwagens verstehen',
      summary: 'Vier Aufstandsflächen, Lastverlagerung und woher der Grip kommt.',
      figureTitle: 'Lastverlagerung ändert die Radlasten, nicht das Gesamtgewicht des Fahrzeugs',
      sections: [
        {
          heading: 'Die vier Aufstandsflächen',
          body: 'Ein Rennwagen steht über vier relativ kleine Reifenaufstandsflächen mit der Strecke in Kontakt. Jede Brems-, Beschleunigungs- und Kurvenkraft läuft letztlich durch sie. Der Fahrer erzeugt keinen Grip, indem er am Lenkrad dreht oder ein Pedal drückt; er fordert Kräfte an, die die Reifen liefern können oder auch nicht. Reifenmischung, Temperatur, Druck, Streckenbelag und Radlast beeinflussen das Ergebnis.',
        },
        {
          heading: 'Lastverlagerung',
          body: 'Beim Bremsen verlagert sich die Last zur Vorderachse, beim Beschleunigen zur Hinterachse und in der Kurve zu den kurvenäußeren Reifen. Das ist dynamische Lastverlagerung, keine tatsächliche Bewegung der Gesamtmasse des Autos. Mehr Last auf einem Reifen erhöht in der Regel seinen absoluten Grip, meist aber weniger als proportional, sodass große Lastverlagerungen die Summe des verfügbaren Grips verringern können. Sanfte Übergänge machen das Auto leichter kontrollierbar.',
        },
        {
          heading: 'Mechanischer und aerodynamischer Grip',
          body: 'Mechanischer Grip kommt von den Reifen, dem Fahrwerk, dem Belag und der Beladung. Aerodynamischer Abtrieb erhöht mit dem Tempo die vertikale Reifenlast, wodurch sich schnelle Kurven meist von langsamen unterscheiden. Ein GT3-Auto verträgt bei hohem Tempo womöglich mehr Lenk- oder Bremsanforderung, doch der Abtrieb nimmt ab, wenn das Auto langsamer wird. Geh nie davon aus, dass eine Technik, die in einer schnellen Kurve funktioniert, in einer Haarnadel genauso funktioniert.',
        },
        {
          heading: 'Anwendung beim Fahren',
          body: 'Geh jede Kurve mit einem klaren Ablauf an: Bremse, solange das Auto stabil ist, bringe die Lenkung schrittweise ein, balanciere das Auto nahe dem Scheitelpunkt und öffne das Lenkrad schrittweise, während du beschleunigst. Nutze ein reproduzierbares Setup und gleichbleibende Reifenbedingungen, bevor du beurteilst, ob ein Fahrverhaltensproblem vom Fahrer oder von der Technik kommt.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Fahre fünf Runden in angenehmem Tempo und konzentriere dich ausschließlich auf sanfte Übergänge zwischen Bremse, Lenkung und Gas. Prüfe, ob das Auto abrupt nickt oder die Richtung ändert. Sanft bedeutet nicht langsam: Es ist die präzise Kontrolle darüber, wie schnell sich die Reifenkräfte ändern.',
        },
      ],
    },
    {
      id: 'traction-circle',
      title: 'Der Kammsche Kreis: Grip-Grenzen verstehen',
      summary: 'Bremsen, Beschleunigen und Lenken teilen sich ein begrenztes Kraftbudget.',
      figureTitle: 'Kammscher Kreis: gemeinsames Kraftbudget des Reifens',
      sections: [
        {
          heading: 'Ein gemeinsames Kraftbudget',
          body: 'Ein Reifen kann Längskraft zum Bremsen oder Beschleunigen und Querkraft zum Lenken erzeugen. Diese Anforderungen konkurrieren um eine begrenzte Kapazität. Der Kammsche Kreis ist ein nützliches gedankliches Modell: Ist ein Reifen nahe an der maximalen Bremsung geradeaus, steht kaum noch zusätzliche Querkraft zur Verfügung. In der Praxis ähnelt die Grenze oft einer Ellipse und ändert sich mit Last, Tempo, Belag und Reifenzustand.',
        },
        {
          heading: 'Eingaben kombinieren',
          body: 'Wer mit maximaler Bremsung in eine Kurve fährt, muss die Bremskraft verringern, während die Lenkanforderung wächst. Am Scheitelpunkt kann die Queranforderung hoch und die Gasanforderung gering sein. Am Ausgang nimmt der Fahrer die Lenkung allmählich zurück und gibt mehr Gas. Dieser abgestimmte Austausch von Kräften ist die zentrale Fähigkeit des sportlichen Fahrens.',
        },
        {
          heading: 'Was die Abbildung bedeutet',
          body: 'Die Abbildung verwendet normierte Kraftachsen; sie ist keine kalibrierte Karte eines bestimmten Reifens. Punkte innerhalb der Grenze stehen für machbare Kombinationen; Punkte darüber hinaus bedeuten Rutschen, blockierende Räder, ABS-Eingriffe, Traktionskontrolle oder eine Kombination davon. Die tatsächlich verfügbare Grenze ist an jedem Rad anders.',
        },
        {
          heading: 'Häufiger Fehler',
          kind: 'error',
          body: 'Einsteiger fordern oft gleichzeitig vollen Bremsdruck und einen großen Lenkwinkel. Ein weiterer häufiger Fehler ist Vollgas, bevor das Lenkrad weit genug geöffnet ist. Beides überlastet das Kraftbudget der Reifen. Die Lösung ist nicht unbedingt ein insgesamt niedrigeres Tempo, sondern besseres Timing und bessere Übergänge.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Bremse in einer gleichmäßigen, mittelschnellen Kurve kräftig geradeaus und nimm dann bewusst den Druck zurück, während die Lenkung zunimmt. Wiederhole das mit einer kleinen, kontrollierten Überlappung. Vergleiche Stabilität und Mindesttempo, nicht nur, wie spät du bremsen kannst.',
        },
      ],
    },
    {
      id: 'racing-line',
      title: 'Die Ideallinie: Geometrie und Tempo',
      summary: 'Außen–innen–außen, Referenzpunkte und die Wahl des Scheitelpunkts.',
      figureTitle: 'Verschiedene Linien tauschen Eingangsradius gegen Position am Ausgang',
      sections: [
        {
          heading: 'Beginne mit außen–innen–außen',
          body: 'Wer die verfügbare Streckenbreite nutzt, kann den Kurvenradius vergrößern und so die bei einem bestimmten Tempo nötige Querbeschleunigung verringern. Die einfache Linie außen–innen–außen ist ein guter Ausgangspunkt: weit anfahren, zum Scheitelpunkt einlenken und das Auto am Ausgang nach außen tragen lassen. Die ideale Linie hängt von der nächsten Kurve, dem Grip, dem Verkehr, den Randsteinen und dem Auto ab.',
        },
        {
          heading: 'Referenzpunkte',
          body: 'Wähle eine Bremsmarke, einen Einlenkpunkt, eine Scheitelpunkt-Referenz und ein Ausgangsziel. Eine gute Referenz ist fest und sichtbar: ein Schild, eine Asphaltnaht, der Beginn eines Randsteins oder ein Streckenposten. Meide Schatten und temporäre Objekte. Schau zur nächsten Referenz, bevor du die aktuelle erreichst, statt auf die Frontstoßstange zu starren.',
        },
        {
          heading: 'Früher und später Scheitelpunkt',
          body: 'Ein früher Scheitelpunkt kann das Auto am Ausgang nach außen tragen und das Gasgeben verzögern. Ein späterer Scheitelpunkt opfert oft etwas Eingangstempo für eine bessere Ausrichtung am Ausgang und mehr Beschleunigung, besonders vor einer langen Geraden. Keiner von beiden ist immer schneller. Der geometrische Scheitelpunkt ist nur ein nützlicher geometrischer Ausgangspunkt, keine Regel.',
        },
        {
          heading: 'Kurvenkombinationen',
          body: 'Die schnellste Linie durch eine Kurve kann die nächste beeinträchtigen. In einer Links-rechts-Folge kann es sich lohnen, die erste Kurve auf der Seite zu verlassen, die die zweite vorbereitet. Behandle verbundene Kurven als ein einziges Optimierungsproblem und achte besonders auf den letzten Ausgang.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Wähle eine Kurve und fahre drei reproduzierbare Linien: leicht früher, neutraler und leicht später Scheitelpunkt. Vergleiche die Zeit im Kurvenabschnitt und das Tempo 100–200 Meter nach dem Ausgang. Halte die Streckenlimits ein und mache die Änderungen so klein, dass du sie noch auswerten kannst.',
        },
      ],
    },
    {
      id: 'braking',
      title: 'Bremsen: Wo die Rundenzeit gewonnen oder verloren wird',
      summary: 'Threshold-Braking, das Lösen der Bremse und wie man eine Bremszone misst.',
      figureTitle: 'Beispielhafte Bremsdruckkurven',
      sections: [
        {
          heading: 'Bremsen ist ein Ablauf',
          body: 'Eine gute Bremszone besteht aus dem ersten Pedaldruck, der maximalen Verzögerung, dem kontrollierten Lösen und dem Übergang zur Lenkung. Der richtige Bremspunkt hängt von Eingangstempo, Gefälle, Reifengrip, Abtrieb, Sprit und dem nötigen Tempo am Kurveneingang ab. Später zu bremsen ist nur dann schneller, wenn das Auto trotzdem mit dem richtigen Einlenktempo und in der richtigen Position ankommt.',
        },
        {
          heading: 'Threshold-Braking',
          body: 'Threshold-Braking soll den verfügbaren Längsgrip der Reifen ausnutzen, ohne dass die Räder unkontrolliert blockieren. Baue den Druck schnell auf, aber progressiv genug, um eine destabilisierende Spitze zu vermeiden. Mit sinkendem Tempo kann die aerodynamische Last abnehmen und damit auch der zulässige Druck. In einem GT3-Auto mit ABS kann es zu kurzen ABS-Eingriffen kommen; anhaltend starke Eingriffe können auf zu hohe Anforderung oder ein schlechtes Druckprofil hindeuten.',
        },
        {
          heading: 'Das Lösen der Bremse zählt',
          body: 'Wer das Pedal abrupt löst, kann die Vorderachslast verändern und den Übergang zur Lenkung stören. Kontrolliertes Lösen lässt das Auto vorhersehbar eindrehen. Viele fortgeschrittene Fahrer gewinnen mehr Zeit durch besseres Lösen der Bremse als dadurch, dass sie den Bremspunkt einige Meter nach hinten verschieben.',
        },
        {
          heading: 'Bremsen messen',
          body: 'Nutze Bremsdruck, Tempo, Längsbeschleunigung und Distanz. Vergleiche, wo das Bremsen beginnt, den Spitzendruck, wie schnell das Tempo fällt und wo der Druck null erreicht. Ein später Bremspunkt mit langsamem Scheitelpunkt oder beeinträchtigtem Ausgang ist keine Verbesserung. Unterscheide bei der Telemetrieanalyse zwischen Pedalstellung und tatsächlichem Bremsdruck.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Halte die Bremsmarke fünf Runden lang fest. Verbessere zuerst die Druckkurve und das Lösen. Verschiebe die Marke dann in kleinen Schritten und prüfe dabei Scheitelpunkt und Ausgangstempo. Experimentiere nie im Verkehr oder in einem unkontrollierten Umfeld mit maximaler Bremsung.',
        },
      ],
    },
    {
      id: 'trail-braking',
      title: 'Trail-Braking: Die Rotation am Kurveneingang kontrollieren',
      summary: 'Bremsdruck gegen Lenkung tauschen, um Eingangstempo und Rotation zu steuern.',
      figureTitle: 'Trail-Braking: Bremse lösen, während die Lenkanforderung steigt',
      sections: [
        {
          heading: 'Definition',
          body: 'Trail-Braking bedeutet, einen abnehmenden Bremsdruck über das erste Einlenken hinaus mitzunehmen. Statt das Bremsen vor dem Lenken zu beenden, überlappt der Fahrer beides und tauscht dabei Längsanforderung der Reifen gegen Queranforderung. Die Technik kann helfen, das Eingangstempo zu steuern und zu beeinflussen, wie bereitwillig das Auto eindreht.',
        },
        {
          heading: 'Warum es funktioniert',
          body: 'Verzögerung verändert die Radlasten und die verfügbaren Kräfte. Etwas Bremsdruck kann die Vorderachslast halten, während die Hinterreifen weniger Querreserve haben können, was das Gierverhalten beeinflusst. Die genaue Wirkung hängt von Bremsbalance, Differenzial, Reifeneigenschaften, Tempo und Setup ab. Trail-Braking garantiert weder zusätzlichen Grip vorne noch automatische Rotation.',
        },
        {
          heading: 'Das Löseprofil',
          body: 'Beginne mit einer stabilen, überwiegend geraden Bremsphase. Nimm den Bremsdruck sanft zurück, während die Lenkung zunimmt. Halte nicht vollen Bremsdruck bis tief in eine enge Kurve. Das Ziel ist nicht eine vorgegebene Überlappung, sondern ein ausgewogener, reproduzierbarer Übergang, mit dem das Auto der geplanten Linie folgt.',
        },
        {
          heading: 'Wann du es nicht erzwingen solltest',
          body: 'Sehr schnelle Kurven, Bodenwellen, Kuppen, wenig Grip und ein unruhiges Heck können früheres Lösen der Bremse oder ein vorsichtigeres Vorgehen erfordern. Manche Kurven fährt man am besten mit einer Bremsung geradeaus und anschließend sauberem Einlenken. Wenn das Heck zu schnell eindreht, verringere die kombinierte Anforderung und stabilisiere zuerst das Auto.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Vergleiche in einer gutmütigen, mittelschnellen Kurve ein sauberes Lösen geradeaus mit einem kleinen Rest an Bremsdruck. Prüfe die Kurven von Bremse und Lenkung, das Mindesttempo, das Gierverhalten und die Qualität des Ausgangs. Ändere immer nur eine Variable.',
        },
      ],
    },
    {
      id: 'cornering',
      title: 'Kurventechnik: Eingang, Scheitelpunkt und Ausgang',
      summary: 'Ein durchgehendes Manöver: Plattform aufbauen, balancieren, Lenkrad öffnen.',
      figureTitle: 'Kurvenphasen und der Bereich des Mindesttempos',
      sections: [
        {
          heading: 'Eingang: Plattform aufbauen',
          body: 'Der Kurveneingang beginnt vor dem Einlenken. Der Fahrer wählt einen Bremspunkt, kommt mit passendem Tempo an und positioniert das Auto für einen fahrbaren Radius. Der Blick nach vorn ist entscheidend: Die Aufmerksamkeit sollte vom Einlenkpunkt zum Scheitelpunkt und dann zum Ausgang wandern. Zu viel Einsatz am Eingang erhöht meist die Lenkanforderung und kann das Beschleunigen verzögern.',
        },
        {
          heading: 'Kurvenmitte: Balance',
          body: 'Nahe dem Scheitelpunkt sind Lenkung und Querbeschleunigung oft erheblich. Ein ausgewogenes Auto braucht je nach Kurve und Setup etwas Erhaltungsgas, ein sanftes Lupfen oder gar kein Gas. Das Ziel ist nicht immer das höchste Mindesttempo, sondern das Tempo, das die beste Gesamtzeit im Abschnitt ermöglicht.',
        },
        {
          heading: 'Ausgang: Lenkrad öffnen',
          body: 'Wenn das Auto zum Ausgang dreht, beginne die Lenkanforderung zu verringern und gib schrittweise mehr Gas. Das Kraftbudget der Reifen erlaubt mehr Beschleunigung, wenn die Queranforderung sinkt. Das Hinaustragen sollte bewusst und vorhersehbar sein und nicht die Folge von fehlendem Grip vorne.',
        },
        {
          heading: 'Ein nützliches Denkmodell',
          body: 'Betrachte die Kurve als ein durchgehendes Manöver statt als drei getrennte Aktionen. Spätes oder abruptes Lösen der Bremse beeinflusst die Balance am Scheitelpunkt; die Position am Scheitelpunkt beeinflusst, wann das Lenkrad geöffnet werden kann; das wiederum beeinflusst, wie früh die volle Leistung verfügbar ist. Die Phasen sind Bezeichnungen für die Analyse, keine harten Grenzen bei den Eingaben.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Bestimme vier Orientierungspunkte in einer einzigen Kurve: Bremsen, Einlenken, Scheitelpunkt, Ausgang. Triff jeden davon konstant, bevor du versuchst, schneller zu werden. Suche im Video oder in der Telemetrie nach der ersten Phase, in der ein Fehler auftritt.',
        },
      ],
    },
    {
      id: 'exit-speed',
      title: 'Ausgangstempo: Aus guten Kurven schnelle Runden machen',
      summary: 'Warum sich ein Tempovorteil am Ausgang die ganze Gerade hindurch auszahlt.',
      figureTitle: 'Der Tempovorteil am Ausgang wirkt auf der Geraden weiter',
      sections: [
        {
          heading: 'Warum Ausgänge wichtig sind',
          body: 'Ein Tempovorteil am Ausgang bleibt auf der folgenden Geraden bestehen und kann einen Zeitgewinn bringen, der weit über die Kurve selbst hinausgeht. Wer früher mit einem besser ausgerichteten Auto Vollgas erreicht, kann weiter an Distanz gewinnen. Das ist besonders vor langen Geraden wertvoll, auch wenn der genaue Zeitgewinn von Beschleunigung und Luftwiderstand abhängt.',
        },
        {
          heading: 'Früher ist nicht immer besser',
          body: 'Der erste Moment am Gas ist nicht dasselbe wie wirksame Beschleunigung. Zu frühes Gasgeben kann durchdrehende Räder, Eingriffe der Traktionskontrolle, Leistungsuntersteuern oder einen weiteren Ausgang verursachen, der zum Lupfen zwingt. Entscheidend ist, wie viel Beschleunigung du erreichst, während du die gewünschte Linie hältst.',
        },
        {
          heading: 'Eingang gegen Ausgang tauschen',
          body: 'In einer langsamen Kurve vor einer langen Geraden kann ein etwas langsamerer Eingang oder ein späterer Scheitelpunkt früheres Öffnen des Lenkrads und stärkere Beschleunigung ermöglichen. Ein Fahrer kann am Eingang ein wenig Zeit verlieren und am Ausgang mehr gewinnen. Prüfe das anhand der Abschnittszeit und der Tempokurven, statt anzunehmen, dass ein später Scheitelpunkt immer gewinnt.',
        },
        {
          heading: 'Die richtigen Kennzahlen lesen',
          body: 'Vergleiche das Tempo an einer festen Ausgangsmarke, den Gasaufbau, den Lenkwinkel und das Tempo 100 oder 200 Meter später. Vergleiche nach Möglichkeit denselben Gang, dieselbe Spritmenge, denselben Reifenzustand und dieselben Streckenbedingungen. Das Ausgangstempo an einer Marke sagt mehr aus als ein einzelner Spitzenwert.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Wähle die langsame Kurve vor der längsten Geraden. Nimm kleine Änderungen am Timing des Scheitelpunkts und am Gasaufbau vor. Bewerte die Runden nach der Zeit vom Einlenken bis zu einem festen Punkt weit auf der Geraden, nicht nur nach dem Tempo am Scheitelpunkt.',
        },
      ],
    },
    {
      id: 'understeer-oversteer',
      title: 'Untersteuern und Übersteuern: Rotation verstehen',
      summary: 'Ungleichgewicht je nach Kurvenphase erkennen und richtig reagieren.',
      figureTitle: 'Der Gier-Vergleich braucht Tempo, Lenkung und Kontext',
      sections: [
        {
          heading: 'Untersteuern',
          body: 'Untersteuern tritt auf, wenn das Auto weniger einlenkt als gefordert: Die Vorderreifen können im Verhältnis zu den Hinterreifen nicht genug Querkraft liefern. Das Auto schiebt weiter nach außen als beabsichtigt. Ursachen können zu hohes Eingangstempo, abruptes Lenken, überlastete Vorderreifen beim Bremsen oder bei manchen Antriebsarten zu frühes Gasgeben sein.',
        },
        {
          heading: 'Übersteuern',
          body: 'Übersteuern tritt auf, wenn das Heck im Verhältnis zur Front stärker eindreht als beabsichtigt. Es kann durch abruptes Gaswegnehmen, zu viel Trail-Braking, aggressives Gasgeben, überlastete Hinterreifen oder ein rotationsfreudiges Setup entstehen. Leichte, kontrollierte Rotation kann nützlich sein; ein wachsender Schräglaufwinkel hinten, der viel Gegenlenken erfordert, ist meist langsamer und riskanter.',
        },
        {
          heading: 'Die Kurvenphase gibt Hinweise',
          body: 'Untersteuern am Eingang deutet oft auf Tempo, Bremsen und Einlenken hin. Untersteuern in der Kurvenmitte kann mit Linie, Balance oder Reifengrip zusammenhängen. Untersteuern am Ausgang kann am Timing des Gasgebens oder an zu wenig geöffneter Lenkung liegen. Übersteuern am Eingang kann vom Lösen der Bremse oder der Stabilität des Hecks kommen; Leistungsübersteuern entsteht typischerweise beim Beschleunigen. Das sind Hinweise, keine endgültigen Diagnosen.',
        },
        {
          heading: 'Korrekturen',
          body: 'Bei Untersteuern solltest du nicht weiter einlenken, wenn die Vorderreifen schon am Limit sind; verringere die Anforderung und lass die Reifen wieder greifen. Bei Übersteuern reagiere rasch mit passendem Gegenlenken und dosierten Pedaleingaben und vermeide abrupte Korrekturen, die einen Pendeleffekt auslösen. Das Abfangen in einem echten Auto sollte mit qualifizierter Anleitung in kontrollierter Umgebung geübt werden.',
        },
        {
          heading: 'Telemetrie auswerten',
          body: 'Lenkwinkel, Tempo, Gierrate, Querbeschleunigung, Gas und Bremse helfen, ein wahrscheinliches Ungleichgewicht zu erkennen. Eine vereinfachte Referenz-Gierrate ist das Tempo geteilt durch den Bahnradius, aber der Radius lässt sich aus dem Gieren allein nicht zuverlässig bestimmen. Der Vergleich des tatsächlichen Gierens mit einem Fahrzeugmodell aus Lenkung und Tempo ist nur sinnvoll, wenn es auf Lenkübersetzung, Radstand, Reifenverhalten und Vorzeichenkonventionen kalibriert ist. Eine abweichende Gierrate allein beweist weder Unter- noch Übersteuern.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Sieh dir drei Kurven mit einem Coach oder im Replay an. Ordne jedes Fahrverhaltensereignis einer Phase und einem wahrscheinlichen Auslöser zu. Gleiche die Beobachtung mit den Pedal- und Lenkkurven ab, bevor du das Setup änderst.',
        },
      ],
    },
    {
      id: 'connecting-corners',
      title: 'Kurven verbinden: Eine Abfolge optimieren',
      summary: 'Eine Runde ist eine Abfolge, keine Sammlung von Kurvenrekorden.',
      figureTitle: 'Schikane: Entscheidend ist, wo das Auto am Ende steht',
      sections: [
        {
          heading: 'Die Abfolge optimieren',
          body: 'Eine Runde ist keine Sammlung unabhängiger Kurvenrekorde. Der Ausgang einer Kurve legt die Eingangsbedingungen der nächsten fest. In einer Schikane oder einer Reihe von Esses kann ein aggressiver erster Scheitelpunkt das Auto für die letzte Kurve und die folgende Gerade schlecht positionieren.',
        },
        {
          heading: 'Den letzten Ausgang priorisieren',
          body: 'Führt die letzte Kurve auf eine lange Gerade, arbeite dich von der idealen Position und Ausrichtung am Ausgang rückwärts. Das kann eine zurückhaltende erste Kurve, eine flachere erste Linie oder einen früheren Lenkwechsel erfordern. Der richtige Kompromiss hängt vom Abstand, Tempo, der Form der Randsteine und dem Verhalten des Autos ab.',
        },
        {
          heading: 'Richtungswechsel',
          body: 'Schnelle Richtungswechsel erfordern präzises Lastmanagement. Ein abrupter Links-rechts-Lenkwechsel kann eine starke seitliche Lastverlagerung erzeugen und das Heck unruhig machen. Sanftes, zielgerichtetes Lenken und passende Gasbalance halten das Auto stabil und vermeiden unnötige Strecke.',
        },
        {
          heading: 'Verkehr ändert die Antwort',
          body: 'Im Rennen steht die schnellste Solo-Linie womöglich nicht zur Verfügung. Verteidigungspositionen, Überholmanöver und beeinträchtigte Eingänge erfordern andere Prioritäten. Lass genug Reserve, um auf andere Autos zu reagieren, besonders beim Bremsen oder Einlenken Seite an Seite.',
        },
        {
          heading: 'Übung',
          kind: 'drill',
          body: 'Vergleiche zwei Linien durch eine Kombination aus zwei Kurven. Miss die Gesamtzeit von der ersten Bremsmarke bis zu einem Punkt nach dem letzten Ausgang. Ignoriere, welche einzelne Kurve sich schneller anfühlt; bewerte die gesamte Abfolge.',
        },
      ],
    },
    {
      id: 'practice-and-telemetry',
      title: 'Alles zusammen: Training und Telemetrie',
      summary: 'Erst Konstanz, dann messen, eine Sache ändern und wiederholen.',
      figureTitle: 'Überlagerte Kurven zeigen, wo Tempounterschiede entstehen',
      sections: [
        {
          heading: 'Konstanz vor maximalem Angriff',
          body: 'Ein Fahrer kann Verbesserungen nicht zuverlässig erkennen, wenn die Schwankung von Runde zu Runde größer ist als die getestete Technikänderung. Beginne mit einer stabilen Basis: nach Möglichkeit dasselbe Auto, dieselbe Streckenkonfiguration, dieselben Reifenbedingungen und dieselbe Spritannahme. Fahre reproduzierbare Runden in einem Tempo, das dir genug Aufmerksamkeit lässt, um zu beobachten, was das Auto macht.',
        },
        {
          heading: 'Eine nützliche Telemetrie-Reihenfolge',
          body: 'Beginne mit Tempo über Distanz, weil das zeigt, wo Zeit verloren geht. Prüfe dann Bremsdruck und Lösen, Gasaufnahme und Gasaufbau, Lenkanforderung und die verfügbaren Beschleunigungen. Lege vergleichbare Runden nach Distanz ausgerichtet übereinander. Die Bremsmarke eines schnelleren Fahrers ist nicht unbedingt das richtige Ziel, wenn seine Linie oder sein Eingangstempo abweicht.',
        },
        {
          heading: 'Das gesamte Ergebnis messen',
          body: 'Nützliche Kurvenkennzahlen sind Eingangstempo, Bremsbeginn, Spitzenbremsdruck, Lösedistanz, Mindesttempo, Gasaufnahme, Vollgaspunkt, Ausgangstempo und Gesamtzeit im Abschnitt. Rollstrecke und Überlappung von Bremse und Gas können Kontext liefern, sind aber nicht per se schlecht: Kurzes Rollen oder Überlappen kann für ein bestimmtes Auto und eine bestimmte Kurve passend sein.',
        },
        {
          heading: 'Ein reproduzierbarer Verbesserungszyklus',
          body: 'Beobachte ein wiederkehrendes Problem; stelle eine Hypothese auf; wähle eine einzige Eingabeänderung; fahre mehrere konstante Runden; vergleiche die gesamte Kurve und die anschließende Gerade; behalte oder verwirf die Änderung. Ändere nicht gleichzeitig Setup, Bremsmarke, Scheitelpunkt und Gasstrategie, weil das Ergebnis sonst schwer zu deuten ist.',
        },
        {
          heading: 'Entwicklungsplan für vier Sessions',
          body: 'Session 1: Lerne die Referenzen und wiederhole eine stabile Linie.\nSession 2: Verfeinere Bremsdruck und Lösen.\nSession 3: Verbessere die Position am Scheitelpunkt und die Beschleunigung am Ausgang.\nSession 4: Analysiere die Telemetrie und konzentriere dich auf die zwei Kurven mit dem größten reproduzierbaren Zeitverlust.\nWiederhole den Zyklus, wenn du die Strecke besser kennst.',
        },
        {
          heading: 'Letztes Prinzip',
          kind: 'principle',
          body: 'Tempo ist das Ergebnis davon, den verfügbaren Grip effizient zu nutzen, das Auto genau zu platzieren und jede Eingabe der nächsten Phase der Runde dienen zu lassen. Fahre mit Absicht, miss das Ergebnis und ändere immer nur eine Sache.',
        },
      ],
    },
  ],
  figures: {
    front: 'VORNE',
    rear: 'HINTEN',
    brakingLoad: 'Bremsen: Last nach vorne',
    acceleratingLoad: 'Beschleunigen: Last nach hinten',
    corneringLoad: ['Kurvenfahrt: Last', 'zu den äußeren Reifen'],
    accelerating: 'BESCHLEUNIGEN',
    braking: 'BREMSEN',
    turning: 'LENKEN',
    tireLimit: 'Grenze der Reifenkraft (normiert)',
    trailPath: 'Beispielhafter Trail-Braking-Verlauf',
    progressThroughCorner: 'Fortschritt durch die Kurve',
    lateralPosition: 'Seitliche Position (schematisch)',
    geometricApex: 'Geometrischer Scheitelpunkt',
    geometricArc: 'Geometrischer Bogen',
    laterApexPath: 'Linie mit späterem Scheitelpunkt',
    brakingZoneDistance: 'Distanz durch die Bremszone (normiert)',
    brakeCommand: 'Bremsbefehl (%)',
    plannedThreshold: 'Geplantes Threshold-Braking',
    lateAbrupt: 'Spätes, abruptes Bremsen',
    cornerEntryProgression: 'Verlauf des Kurveneingangs',
    normalizedInput: 'Normierte Eingabe',
    brakePressure: 'Bremsdruck (%)',
    steeringDemand: 'Lenkanforderung (relativ)',
    illustrativeSpeed: 'Tempo (km/h, beispielhaft)',
    entry: 'Eingang',
    apex: 'Scheitel',
    exit: 'Ausgang',
    speed: 'Tempo',
    distanceAfterCorner: 'Distanz nach der Kurve (m)',
    speedKmh: 'Tempo (km/h)',
    driverA: 'Fahrer A: langsamerer Ausgang',
    driverB: 'Fahrer B: +5 km/h am Ausgang',
    cornerProgression: 'Kurvenverlauf',
    yawRate: 'Gierrate (schematisch)',
    referenceYaw: 'Referenz-Gierverhalten',
    underRotation: 'Zu wenig Rotation (mögliches Untersteuern)',
    overRotation: 'Zu viel Rotation (mögliches Übersteuern)',
    twoCornerProgress: 'Fortschritt durch die Zwei-Kurven-Kombination',
    balancedPath: 'Ausgewogene Linie mit Vorrang für den letzten Ausgang',
    alternativePath: 'Alternative Linie',
    normalizedCornerDistance: 'Normierte Kurvendistanz',
    currentLap: 'Aktuelle Runde',
    referenceLap: 'Referenzrunde',
  },
};
