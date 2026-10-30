import type { Language } from '@/lib/i18n/languages';

// The coach's biography on the Pro Driving Lesson page (src/app/prodrivinglesson/page.tsx), in each language.
// Paragraphs may use **bold** and *italic*.

export type ProDriverBio = {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
};

const en: ProDriverBio = {
  title: 'Professional Sim Racing Driver & Coach',
  sections: [
    {
      heading: 'Racing Career & Background',
      paragraphs: [
        'With a competitive racing career spanning more than two decades, this accomplished sim racer and professional driving coach has competed at the highest levels of virtual motorsport, including the iRacing World Championship Series (WCS) and the prestigious Mazda Road to 24 qualifying competition.',
        "His passion for racing began with classic titles such as *Super Monaco GP* on the Sega Mega Drive. In 2007, he transitioned into serious competitive sim racing through *Live for Speed*, developing the skills that would eventually establish him among the world's elite virtual drivers.",
        'Joining iRacing in 2009, he quickly made his mark, securing his first official series championship in 2010. His success earned him a place in the 2011 iRacing Road Pro Series and qualification for the Intel Extreme Masters online finals. In 2012, he finished among the **top nine drivers in the iRacing World Championship Series** while also reaching the GT Academy finals.',
        'Following a brief hiatus in 2014, he returned to competition with Iberica Racing Team, achieving numerous victories and championship titles. His accomplishments included winning the RaceDepartment SimRacingTeams Black Cup, the Masters of Endurance 1000km of Suzuka, and the 2015 Class A Grand Prix Series championship. His outstanding performance in the Road Pro Series secured another appearance in the 2016 iRacing World Championship Series.',
        "In 2016, he shifted his focus from open-wheel racing to sports cars, competing in the Mazda European MX-5 Cup and finishing fourth overall. That same year, he was selected as iRacing's representative for the **Mazda Road to 24**, competing for an opportunity to earn a $100,000 scholarship toward a real-world Global Mazda MX-5 Cup racing career at NOLA Motorsports Park in New Orleans.",
        'His competitive success continued in 2017 with victory in the inaugural SEAT Leon Eurocup Online race and a third-place finish in the iRacing 24 Hours of Nürburgring.',
        'In 2018, he qualified for the Blancpain GT World Championship Series and joined Teo Martin eSports, further establishing his reputation in international sim racing. The following year, racing for Vodafone Giants, he achieved a third-place finish in the official 24 Hours of Barcelona, along with two victories and a runner-up finish in the Ferrari GT3 Challenge Fixed series.',
        "In 2020, he joined Ford's official esports racing team, **Team Fordzilla**, where he captured the BMW 12.0 Challenge Season 2 championship after finishing runner-up in Season 1.",
      ],
    },
    {
      heading: 'Professional Coaching Experience',
      paragraphs: [
        'Beyond his extensive racing achievements, he has developed a distinguished career as a professional driving instructor and sim racing coach.',
        'His coaching experience includes working with **Virtual Racing School (VRS)**, helping drivers improve their racing technique, consistency, and overall performance through advanced telemetry analysis and personalized instruction.',
        'His expertise also extends beyond virtual motorsport into real-world driver development. He has served as an instructor for Mercedes Driving Events Portugal and the Spanish Racing Drivers School, providing hands-on coaching at professional driving facilities throughout Portugal and Spain.',
        'Combining elite-level competitive experience with real-world motorsport instruction, he brings a comprehensive understanding of vehicle dynamics, racecraft, braking techniques, car control, and performance optimization.',
        'His coaching philosophy emphasizes developing fundamental driving skills, understanding vehicle behavior, and applying data-driven techniques to help drivers become faster, more consistent, and more competitive on track.',
      ],
    },
  ],
};

const es: ProDriverBio = {
  title: 'Piloto profesional de simracing y coach',
  sections: [
    {
      heading: 'Trayectoria y antecedentes',
      paragraphs: [
        'Con una carrera competitiva de más de dos décadas, este destacado simracer y coach de manejo profesional ha competido en los niveles más altos del automovilismo virtual, incluidos el iRacing World Championship Series (WCS) y la prestigiosa competencia clasificatoria Mazda Road to 24.',
        'Su pasión por las carreras comenzó con títulos clásicos como *Super Monaco GP* en la Sega Mega Drive. En 2007 dio el salto al simracing competitivo con *Live for Speed*, desarrollando las habilidades que con el tiempo lo situarían entre los pilotos virtuales de élite del mundo.',
        'Se unió a iRacing en 2009 y rápidamente dejó su huella, consiguiendo su primer campeonato de una serie oficial en 2010. Su éxito le valió un lugar en la iRacing Road Pro Series de 2011 y la clasificación para las finales online de Intel Extreme Masters. En 2012 terminó entre los **nueve mejores pilotos del iRacing World Championship Series** y además llegó a las finales de GT Academy.',
        'Tras una breve pausa en 2014, regresó a la competencia con Iberica Racing Team, logrando numerosas victorias y títulos. Entre sus logros están la RaceDepartment SimRacingTeams Black Cup, los Masters of Endurance 1000 km de Suzuka y el campeonato Class A Grand Prix Series de 2015. Su destacado desempeño en la Road Pro Series le aseguró otra participación en el iRacing World Championship Series de 2016.',
        'En 2016 cambió los monoplazas por los autos deportivos, compitiendo en la Mazda European MX-5 Cup, donde terminó cuarto en la general. Ese mismo año fue elegido representante de iRacing para la **Mazda Road to 24**, compitiendo por una beca de 100.000 dólares para una carrera real en la Global Mazda MX-5 Cup en NOLA Motorsports Park, en Nueva Orleans.',
        'Su éxito continuó en 2017 con la victoria en la carrera inaugural de la SEAT León Eurocup Online y un tercer lugar en las 24 Horas de Nürburgring de iRacing.',
        'En 2018 se clasificó para la Blancpain GT World Championship Series y se unió a Teo Martín eSports, consolidando su reputación en el simracing internacional. Al año siguiente, corriendo para Vodafone Giants, logró el tercer lugar en las 24 Horas de Barcelona oficiales, además de dos victorias y un segundo lugar en la serie Ferrari GT3 Challenge Fixed.',
        'En 2020 se unió al equipo oficial de esports de Ford, **Team Fordzilla**, con el que ganó el campeonato BMW 12.0 Challenge Temporada 2, tras haber sido subcampeón en la Temporada 1.',
      ],
    },
    {
      heading: 'Experiencia como coach profesional',
      paragraphs: [
        'Más allá de sus amplios logros en pista, ha desarrollado una destacada carrera como instructor de manejo profesional y coach de simracing.',
        'Su experiencia como coach incluye su trabajo con **Virtual Racing School (VRS)**, ayudando a los pilotos a mejorar su técnica, su consistencia y su rendimiento general mediante análisis avanzado de telemetría e instrucción personalizada.',
        'Su experiencia va más allá del automovilismo virtual y llega a la formación de pilotos en el mundo real. Ha sido instructor de Mercedes Driving Events Portugal y de la Spanish Racing Drivers School, dando clases prácticas en instalaciones profesionales de manejo en Portugal y España.',
        'Al combinar experiencia competitiva de élite con instrucción en automovilismo real, aporta un conocimiento integral de la dinámica del vehículo, el racecraft, las técnicas de frenado, el control del auto y la optimización del rendimiento.',
        'Su filosofía como coach se centra en desarrollar las habilidades fundamentales de manejo, entender el comportamiento del vehículo y aplicar técnicas basadas en datos para que los pilotos sean más rápidos, más consistentes y más competitivos en la pista.',
      ],
    },
  ],
};

const pt: ProDriverBio = {
  title: 'Piloto profissional de simracing e coach',
  sections: [
    {
      heading: 'Carreira e trajetória',
      paragraphs: [
        'Com uma carreira competitiva de mais de duas décadas, este experiente simracer e coach de pilotagem profissional competiu nos mais altos níveis do automobilismo virtual, incluindo o iRacing World Championship Series (WCS) e a prestigiada competição classificatória Mazda Road to 24.',
        'Sua paixão por corridas começou com títulos clássicos como *Super Monaco GP* no Sega Mega Drive. Em 2007, passou para o simracing competitivo com *Live for Speed*, desenvolvendo as habilidades que acabariam por colocá-lo entre os pilotos virtuais de elite do mundo.',
        'Ao entrar no iRacing em 2009, logo deixou sua marca, conquistando seu primeiro campeonato de série oficial em 2010. O sucesso lhe rendeu uma vaga na iRacing Road Pro Series de 2011 e a classificação para as finais online do Intel Extreme Masters. Em 2012, terminou entre os **nove melhores pilotos do iRacing World Championship Series** e também chegou às finais da GT Academy.',
        'Após uma breve pausa em 2014, voltou a competir com a Iberica Racing Team, conquistando inúmeras vitórias e títulos. Entre suas conquistas estão a RaceDepartment SimRacingTeams Black Cup, os Masters of Endurance 1000 km de Suzuka e o campeonato Class A Grand Prix Series de 2015. Seu desempenho de destaque na Road Pro Series garantiu mais uma participação no iRacing World Championship Series de 2016.',
        'Em 2016, trocou os monopostos pelos carros esportivos, competindo na Mazda European MX-5 Cup e terminando em quarto lugar na geral. No mesmo ano, foi escolhido como representante do iRacing na **Mazda Road to 24**, disputando uma bolsa de 100 mil dólares para uma carreira real na Global Mazda MX-5 Cup no NOLA Motorsports Park, em Nova Orleans.',
        'O sucesso continuou em 2017 com a vitória na corrida inaugural da SEAT León Eurocup Online e o terceiro lugar nas 24 Horas de Nürburgring do iRacing.',
        'Em 2018, classificou-se para a Blancpain GT World Championship Series e entrou para a Teo Martín eSports, consolidando sua reputação no simracing internacional. No ano seguinte, correndo pela Vodafone Giants, conquistou o terceiro lugar nas 24 Horas de Barcelona oficiais, além de duas vitórias e um segundo lugar na série Ferrari GT3 Challenge Fixed.',
        'Em 2020, entrou para a equipe oficial de esports da Ford, **Team Fordzilla**, com a qual venceu o campeonato BMW 12.0 Challenge Temporada 2, depois de ser vice-campeão na Temporada 1.',
      ],
    },
    {
      heading: 'Experiência como coach profissional',
      paragraphs: [
        'Além de suas amplas conquistas nas pistas, construiu uma carreira de destaque como instrutor de pilotagem profissional e coach de simracing.',
        'Sua experiência como coach inclui o trabalho com a **Virtual Racing School (VRS)**, ajudando pilotos a melhorar a técnica, a consistência e o desempenho geral por meio de análise avançada de telemetria e instrução personalizada.',
        'Sua experiência vai além do automobilismo virtual e chega à formação de pilotos no mundo real. Foi instrutor da Mercedes Driving Events Portugal e da Spanish Racing Drivers School, dando aulas práticas em instalações profissionais de pilotagem em Portugal e na Espanha.',
        'Combinando experiência competitiva de elite com instrução de automobilismo real, traz um conhecimento completo de dinâmica veicular, racecraft, técnicas de frenagem, controle do carro e otimização de desempenho.',
        'Sua filosofia como coach enfatiza o desenvolvimento das habilidades fundamentais de pilotagem, a compreensão do comportamento do veículo e a aplicação de técnicas baseadas em dados para ajudar os pilotos a ficarem mais rápidos, mais consistentes e mais competitivos na pista.',
      ],
    },
  ],
};

const de: ProDriverBio = {
  title: 'Professioneller Sim-Racing-Fahrer & Coach',
  sections: [
    {
      heading: 'Rennkarriere & Hintergrund',
      paragraphs: [
        'Mit einer Rennkarriere von mehr als zwei Jahrzehnten hat dieser erfolgreiche Sim-Racer und professionelle Fahrcoach auf höchstem Niveau im virtuellen Motorsport gefahren, unter anderem in der iRacing World Championship Series (WCS) und im renommierten Qualifikationswettbewerb Mazda Road to 24.',
        'Seine Leidenschaft für den Rennsport begann mit Klassikern wie *Super Monaco GP* auf dem Sega Mega Drive. 2007 stieg er mit *Live for Speed* in das ernsthafte kompetitive Sim-Racing ein und entwickelte die Fähigkeiten, die ihn schließlich unter die besten virtuellen Fahrer der Welt brachten.',
        '2009 kam er zu iRacing und machte schnell auf sich aufmerksam: 2010 gewann er seine erste offizielle Serienmeisterschaft. Dieser Erfolg brachte ihm einen Platz in der iRacing Road Pro Series 2011 und die Qualifikation für das Online-Finale der Intel Extreme Masters ein. 2012 beendete er die **iRacing World Championship Series unter den besten neun Fahrern** und erreichte außerdem das Finale der GT Academy.',
        'Nach einer kurzen Pause im Jahr 2014 kehrte er mit dem Iberica Racing Team in den Wettbewerb zurück und holte zahlreiche Siege und Meistertitel. Zu seinen Erfolgen zählen der Gewinn des RaceDepartment SimRacingTeams Black Cup, der Masters of Endurance 1000 km von Suzuka und der Meisterschaft der Class A Grand Prix Series 2015. Seine herausragenden Leistungen in der Road Pro Series sicherten ihm einen weiteren Start in der iRacing World Championship Series 2016.',
        '2016 wechselte er vom Formelsport zu den Sportwagen, fuhr im Mazda European MX-5 Cup und wurde Gesamtvierter. Im selben Jahr wurde er zum Vertreter von iRacing für die **Mazda Road to 24** gewählt und kämpfte im NOLA Motorsports Park in New Orleans um ein Stipendium über 100.000 US-Dollar für eine echte Rennkarriere im Global Mazda MX-5 Cup.',
        'Seine Erfolgsserie setzte sich 2017 mit dem Sieg beim ersten Rennen des SEAT Leon Eurocup Online und einem dritten Platz bei den iRacing 24 Stunden vom Nürburgring fort.',
        '2018 qualifizierte er sich für die Blancpain GT World Championship Series und schloss sich Teo Martin eSports an, was seinen Ruf im internationalen Sim-Racing weiter festigte. Im folgenden Jahr erreichte er für Vodafone Giants den dritten Platz bei den offiziellen 24 Stunden von Barcelona sowie zwei Siege und einen zweiten Platz in der Serie Ferrari GT3 Challenge Fixed.',
        '2020 wechselte er zum offiziellen Esports-Rennteam von Ford, **Team Fordzilla**, wo er die BMW 12.0 Challenge Season 2 gewann, nachdem er in Season 1 Zweiter geworden war.',
      ],
    },
    {
      heading: 'Berufserfahrung als Coach',
      paragraphs: [
        'Neben seinen umfangreichen Rennerfolgen hat er sich eine angesehene Laufbahn als professioneller Fahrinstruktor und Sim-Racing-Coach aufgebaut.',
        'Zu seiner Coaching-Erfahrung gehört die Arbeit mit der **Virtual Racing School (VRS)**, wo er Fahrern mit fortgeschrittener Telemetrieanalyse und persönlichem Unterricht hilft, ihre Renntechnik, Konstanz und Gesamtleistung zu verbessern.',
        'Seine Expertise reicht über den virtuellen Motorsport hinaus bis in die Fahrerentwicklung in der realen Welt. Er war als Instruktor für Mercedes Driving Events Portugal und die Spanish Racing Drivers School tätig und coachte praktisch auf professionellen Fahranlagen in ganz Portugal und Spanien.',
        'Durch die Verbindung von Wettkampferfahrung auf Spitzenniveau mit realem Motorsport-Unterricht bringt er ein umfassendes Verständnis von Fahrdynamik, Racecraft, Bremstechnik, Fahrzeugbeherrschung und Leistungsoptimierung mit.',
        'Seine Coaching-Philosophie legt den Schwerpunkt darauf, grundlegende Fahrfertigkeiten zu entwickeln, das Fahrzeugverhalten zu verstehen und datengestützte Techniken anzuwenden, damit Fahrer schneller, konstanter und konkurrenzfähiger werden.',
      ],
    },
  ],
};

const BIOS: Record<Language, ProDriverBio> = { en, es, pt, de };

export function getProDriverBio(language: Language): ProDriverBio {
  return BIOS[language];
}
