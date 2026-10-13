// The Learning page's guide in Latin American Spanish (the English original and the types are in learningGuide.ts)

import type { Guide } from '@/lib/learningGuide';

export const ES: Guide = {
  title: 'El arte de conducir un auto de carreras',
  subtitle: 'Una guía práctica e ilustrada para pilotos principiantes e intermedios',
  topics: ['Dinámica del vehículo', 'Trazada', 'Frenado', 'Trail braking', 'Rotación', 'Telemetría'],
  note: 'Pensada para el automovilismo en circuito cerrado y los simuladores de carreras, con ejemplos de GT3. En vehículos reales, las técnicas deben practicarse de forma progresiva y con supervisión calificada.',
  chapters: [
    {
      id: 'race-car-dynamics',
      title: 'Entender la dinámica de un auto de carreras',
      summary: 'Cuatro huellas de contacto, la transferencia de carga y de dónde viene el agarre.',
      figureTitle: 'La transferencia de carga cambia la carga de cada neumático, no el peso total del auto',
      sections: [
        {
          heading: 'Las cuatro huellas de contacto',
          body: 'Un auto de carreras interactúa con la pista a través de cuatro huellas de contacto relativamente pequeñas. Toda fuerza de frenado, aceleración y giro pasa, en última instancia, por ellas. El piloto no crea agarre al mover el volante o pisar un pedal; pide fuerzas que los neumáticos pueden o no ser capaces de producir. El compuesto, la temperatura y la presión de los neumáticos, la superficie de la pista y la carga vertical influyen en el resultado.',
        },
        {
          heading: 'Transferencia de carga',
          body: 'Al frenar, la carga se transfiere hacia el eje delantero; al acelerar, hacia el trasero; en una curva, hacia los neumáticos exteriores. Es una transferencia dinámica de carga, no un movimiento literal de la masa total del auto. Más carga sobre un neumático suele aumentar su agarre absoluto, pero normalmente en menor proporción, así que las grandes transferencias de carga pueden reducir la suma del agarre disponible. Las transiciones suaves hacen que el auto sea más fácil de controlar.',
        },
        {
          heading: 'Agarre mecánico y aerodinámico',
          body: 'El agarre mecánico proviene de los neumáticos, la suspensión, la superficie y la carga. La carga aerodinámica aumenta la carga vertical sobre los neumáticos con la velocidad, por lo que las curvas rápidas suelen comportarse distinto de las lentas. Un GT3 puede tolerar una mayor exigencia de dirección o de frenado a alta velocidad, pero la carga aerodinámica disminuye a medida que el auto desacelera. Nunca supongas que una técnica eficaz en una curva rápida funcionará igual en una horquilla.',
        },
        {
          heading: 'Aplicación al manejo',
          body: 'Encara cada curva con una secuencia clara: frena mientras el auto está estable, introduce la dirección de forma progresiva, equilibra el auto cerca del ápice y abre el volante progresivamente mientras aceleras. Usa un setup repetible y condiciones de neumáticos constantes antes de juzgar si un problema de comportamiento lo provoca el piloto o es mecánico.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Da cinco vueltas a un ritmo cómodo y concéntrate solo en transiciones suaves entre frenado, dirección y acelerador. Revisa si el auto cabecea o cambia de dirección de golpe. Suavidad no es lentitud: es controlar con precisión la velocidad a la que cambian las fuerzas de los neumáticos.',
        },
      ],
    },
    {
      id: 'traction-circle',
      title: 'El círculo de tracción: entender los límites de agarre',
      summary: 'Frenar, acelerar y girar comparten un mismo presupuesto finito de fuerza.',
      figureTitle: 'Círculo de tracción: presupuesto combinado de fuerza del neumático',
      sections: [
        {
          heading: 'Un presupuesto de fuerza compartido',
          body: 'Un neumático puede generar fuerza longitudinal para frenar o acelerar y fuerza lateral para girar. Estas demandas compiten por una capacidad finita. El círculo de tracción es un modelo conceptual útil: si un neumático está cerca del máximo frenado en línea recta, queda muy poca fuerza lateral adicional disponible. En la práctica, el límite suele parecerse a una elipse y cambia con la carga, la velocidad, la superficie y el estado del neumático.',
        },
        {
          heading: 'Combinar los comandos',
          body: 'Un piloto que entra a una curva con el máximo frenado debe reducir la fuerza de frenado a medida que aumenta la demanda de dirección. En el ápice, la demanda lateral puede ser alta y la de acelerador, moderada. A la salida, el piloto reduce gradualmente la dirección mientras suma acelerador. Este intercambio coordinado de fuerzas es la habilidad central del manejo de alto rendimiento.',
        },
        {
          heading: 'Qué significa el diagrama',
          body: 'La figura usa ejes de fuerza normalizados; no es un mapa calibrado de ningún neumático en particular. Los puntos dentro del límite representan combinaciones posibles; los que lo superan implican deslizamiento, bloqueo de rueda, intervención del ABS o del control de tracción, o alguna combinación de ellos. El límite real disponible es distinto en cada rueda.',
        },
        {
          heading: 'Error común',
          kind: 'error',
          body: 'Los principiantes suelen pedir presión de freno completa y un gran ángulo de dirección al mismo tiempo. Otro error común es pisar el acelerador a fondo antes de haber abierto lo suficiente el volante. Ambos sobrecargan el presupuesto de fuerza del neumático. La solución no es necesariamente un ritmo general más lento: es un mejor momento y una mejor combinación de los comandos.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'En una curva de velocidad media y constante, frena con firmeza en línea recta y luego reduce la presión deliberadamente a medida que aumenta la dirección. Repite con una superposición pequeña y controlada. Compara la estabilidad y la velocidad mínima, no solo qué tan tarde puedes frenar.',
        },
      ],
    },
    {
      id: 'racing-line',
      title: 'La trazada: geometría y velocidad',
      summary: 'Afuera–adentro–afuera, puntos de referencia y cómo elegir el ápice.',
      figureTitle: 'Distintas trazadas cambian radio de entrada por posición de salida',
      sections: [
        {
          heading: 'Empieza por afuera–adentro–afuera',
          body: 'Usar todo el ancho de la pista puede aumentar el radio de la curva y reducir la aceleración lateral necesaria a una velocidad dada. La trazada básica afuera–adentro–afuera es un buen punto de partida: llega abierto, gira hacia el ápice y deja que el auto se abra a la salida. La trayectoria ideal depende de la curva siguiente, el agarre, el tráfico, los pianos y el auto.',
        },
        {
          heading: 'Puntos de referencia',
          body: 'Elige una marca de frenado, un punto de giro, una referencia de ápice y un objetivo de salida. Una buena referencia es fija y visible: un cartel, una junta del asfalto, el inicio de un piano o un puesto de comisarios. Evita sombras y objetos temporales. Mira hacia la siguiente referencia antes de llegar a la actual, en lugar de fijar la vista en el paragolpes delantero.',
        },
        {
          heading: 'Ápice temprano y ápice tardío',
          body: 'Un ápice temprano puede obligar al auto a abrirse a la salida y retrasar el acelerador. Un ápice más tardío suele sacrificar algo de velocidad de entrada para mejorar la orientación y la aceleración a la salida, sobre todo antes de una recta larga. Ninguno es más rápido en todos los casos. El ápice geométrico es simplemente una geometría inicial útil, no una regla.',
        },
        {
          heading: 'Combinaciones de curvas',
          body: 'La trazada más rápida en una curva puede comprometer la siguiente. En una secuencia izquierda-derecha, puede convenir salir de la primera curva por el lado que prepara la segunda. Trata las curvas enlazadas como un solo problema de optimización, con especial atención a la salida final.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Elige una curva y haz tres trazadas repetibles: ápice ligeramente temprano, neutro y ligeramente tardío. Compara el tiempo del tramo de la curva y la velocidad 100–200 metros después de la salida. Respeta los límites de pista y haz cambios lo bastante pequeños como para poder interpretarlos.',
        },
      ],
    },
    {
      id: 'braking',
      title: 'El frenado: donde se gana o se pierde el tiempo de vuelta',
      summary: 'Frenado al límite, la liberación del freno y cómo medir una zona de frenado.',
      figureTitle: 'Curvas ilustrativas de presión de freno',
      sections: [
        {
          heading: 'Frenar es una secuencia',
          body: 'Una zona de frenado de calidad incluye la aplicación inicial del pedal, la desaceleración máxima, una liberación controlada y la transición a la dirección. El punto de frenado correcto depende de la velocidad de llegada, la pendiente, el agarre de los neumáticos, la carga aerodinámica, el combustible y la velocidad de entrada a la curva que se necesita. Frenar más tarde solo es más rápido si el auto sigue llegando a la velocidad y la posición correctas para girar.',
        },
        {
          heading: 'Frenado al límite',
          body: 'El frenado al límite (threshold braking) busca aprovechar el agarre longitudinal disponible de los neumáticos sin bloqueos descontrolados. Sube la presión rápido, pero de forma lo bastante progresiva para evitar un pico que desestabilice el auto. A medida que baja la velocidad, la carga aerodinámica puede disminuir y cambiar la presión admisible. En un GT3 con ABS puede haber breves intervenciones del ABS; una intervención intensa y sostenida puede indicar exceso de demanda o un mal perfil de presión.',
        },
        {
          heading: 'La liberación del freno importa',
          body: 'Soltar el pedal de golpe puede cambiar la carga delantera y alterar la transición a la dirección. Una liberación controlada permite que el auto rote de forma predecible. Muchos pilotos intermedios ganan más tiempo mejorando la liberación del freno que retrasando su punto de frenado varios metros.',
        },
        {
          heading: 'Medir el frenado',
          body: 'Usa la presión de freno, la velocidad, la aceleración longitudinal y la distancia. Compara dónde empieza el frenado, la presión máxima, qué tan rápido cae la velocidad y dónde la presión llega a cero. Un punto de frenado tardío con un ápice lento o una salida comprometida no es una mejora. Al analizar telemetría, distingue la posición del pedal de la presión real de freno.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Mantén fija la marca de frenado durante cinco vueltas. Primero mejora la forma de la presión y la liberación. Luego ajusta la marca en pequeños incrementos mientras verificas la posición en el ápice y la velocidad de salida. Nunca experimentes con el frenado máximo en tráfico o en un entorno no controlado.',
        },
      ],
    },
    {
      id: 'trail-braking',
      title: 'Trail braking: controlar la rotación en la entrada a la curva',
      summary: 'Cambiar presión de freno por dirección para manejar la velocidad de entrada y la rotación.',
      figureTitle: 'Trail braking: suelta el freno a medida que aumenta la demanda de dirección',
      sections: [
        {
          heading: 'Definición',
          body: 'Hacer trail braking significa mantener una presión de freno decreciente más allá del inicio del giro. En lugar de terminar de frenar antes de empezar a girar, el piloto superpone ambas acciones mientras cambia demanda longitudinal del neumático por demanda lateral. La técnica puede ayudar a controlar la velocidad de entrada e influir en la facilidad con que rota el auto.',
        },
        {
          heading: 'Por qué funciona',
          body: 'La desaceleración cambia las cargas de los neumáticos y las fuerzas disponibles. Mantener algo de presión de freno puede conservar la carga delantera mientras los neumáticos traseros quizá tengan menos reserva lateral, lo que afecta la respuesta de guiñada. El efecto exacto depende del reparto de frenada, el comportamiento del diferencial, las características de los neumáticos, la velocidad y el setup. El trail braking no garantiza más agarre delantero ni rotación automática.',
        },
        {
          heading: 'El perfil de liberación',
          body: 'Empieza con una fase de frenado estable y casi recta. A medida que aumenta la dirección, reduce la presión del freno con suavidad. Evita mantener la presión máxima de freno hasta muy adentro de una curva cerrada. El objetivo no es una cantidad predeterminada de superposición; es una transición equilibrada y repetible que permita al auto seguir la trazada prevista.',
        },
        {
          heading: 'Cuándo no forzarlo',
          body: 'Las curvas muy rápidas, los baches, las crestas, las condiciones de poco agarre y una parte trasera inestable pueden exigir soltar el freno antes o un enfoque más conservador. Algunas curvas se resuelven mejor frenando en línea recta y luego girando limpiamente. Si la parte trasera empieza a rotar demasiado rápido, reduce la demanda combinada y prioriza estabilizar el auto.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'En una curva de velocidad media y que perdone errores, compara una liberación limpia en línea recta con una pequeña cantidad de presión mantenida. Revisa las curvas de freno y dirección, la velocidad mínima, la respuesta de guiñada y la calidad de la salida. Cambia una sola variable a la vez.',
        },
      ],
    },
    {
      id: 'cornering',
      title: 'Técnica de curva: entrada, ápice y salida',
      summary: 'Una sola maniobra continua: establece la plataforma, equilibra, abre el volante.',
      figureTitle: 'Fases de la curva y la zona de velocidad mínima',
      sections: [
        {
          heading: 'Entrada: establece la plataforma',
          body: 'La entrada empieza antes del punto de giro. El piloto elige un punto de frenado, llega a una velocidad adecuada y coloca el auto para lograr un radio manejable. Mirar hacia adelante es esencial: la atención visual debe avanzar del punto de giro al ápice y luego a la salida. Excederse en la entrada suele aumentar la demanda de dirección y puede retrasar la aceleración.',
        },
        {
          heading: 'Mitad de curva: equilibrio',
          body: 'Cerca del ápice, la dirección y la aceleración lateral suelen ser considerables. Un auto equilibrado puede necesitar acelerador de mantenimiento, un leve levantamiento o nada de acelerador, según la curva y el setup. El objetivo no siempre es maximizar la velocidad mínima; es llevar la velocidad que permita el mejor tiempo total del tramo.',
        },
        {
          heading: 'Salida: abre el volante',
          body: 'A medida que el auto rota hacia la salida, empieza a reducir la demanda de dirección y a sumar acelerador de forma progresiva. El presupuesto de fuerza del neumático permite más aceleración a medida que disminuye la demanda lateral. La salida hacia el borde de la pista debe ser deliberada y predecible, no la consecuencia de quedarse sin agarre delantero.',
        },
        {
          heading: 'Un modelo mental útil',
          body: 'Piensa en la curva como una sola maniobra continua y no como tres acciones separadas. Una liberación del freno tardía o brusca afecta el equilibrio en el ápice; la posición en el ápice afecta cuándo se puede abrir el volante; y eso afecta qué tan pronto está disponible toda la potencia. Las fases son etiquetas para el análisis, no límites bruscos entre comandos.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Identifica cuatro referencias en una sola curva: freno, giro, ápice, salida. Haz que el auto pase por cada una de forma constante antes de intentar subir la velocidad. Revisa el video o la telemetría para encontrar la primera fase en la que aparece un error.',
        },
      ],
    },
    {
      id: 'exit-speed',
      title: 'Velocidad de salida: convertir buenas curvas en vueltas rápidas',
      summary: 'Por qué la ventaja en la velocidad de salida se sigue cobrando a lo largo de toda la recta.',
      figureTitle: 'La ventaja en la velocidad de salida se mantiene en la recta',
      sections: [
        {
          heading: 'Por qué importan las salidas',
          body: 'Una ventaja en la velocidad de salida se mantiene a lo largo de la recta siguiente y puede generar una ganancia de tiempo mucho mayor que la de la propia curva. Un piloto que llega antes a fondo con el auto mejor orientado puede seguir ganando distancia. El efecto es especialmente valioso antes de rectas largas, aunque la ganancia exacta depende de la aceleración y la resistencia aerodinámica.',
        },
        {
          heading: 'Antes no siempre es mejor',
          body: 'El primer instante en que se pisa el acelerador no es lo mismo que una aceleración efectiva. Acelerar demasiado pronto puede provocar patinaje, intervención del control de tracción, subviraje por potencia o una salida más abierta que obligue a levantar. La métrica útil es cuánta aceleración se logra manteniendo la trazada deseada.',
        },
        {
          heading: 'Cambia entrada por salida',
          body: 'En una curva lenta que da a una recta larga, una entrada un poco más lenta o un ápice más tardío puede permitir abrir antes el volante y acelerar con más fuerza. Un piloto puede perder un poco de tiempo en la entrada y ganar más a la salida. Compruébalo con el tiempo del tramo y las curvas de velocidad, en lugar de suponer que un ápice tardío siempre gana.',
        },
        {
          heading: 'Mira las métricas correctas',
          body: 'Compara la velocidad en una marca fija de salida, la progresión del acelerador, el ángulo de dirección y la velocidad 100 o 200 metros después. Cuando sea posible, compara con la misma marcha, carga de combustible, estado de neumáticos y condiciones de pista. La velocidad de salida en una marca concreta dice más que un valor aislado de velocidad máxima.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Elige la curva lenta anterior a la recta más larga. Haz pequeños cambios en el momento del ápice y en la progresión del acelerador. Ordena las vueltas por el tiempo desde el punto de giro hasta un punto fijo bien avanzada la recta, no solo por la velocidad en el ápice.',
        },
      ],
    },
    {
      id: 'understeer-oversteer',
      title: 'Subviraje y sobreviraje: entender la rotación',
      summary: 'Reconocer el desequilibrio según la fase de la curva y cómo responder.',
      figureTitle: 'Comparar la guiñada requiere velocidad, dirección y contexto',
      sections: [
        {
          heading: 'Subviraje',
          body: 'El subviraje ocurre cuando el auto gira menos de lo que se le pide: los neumáticos delanteros no logran una respuesta lateral suficiente en relación con los traseros. El auto tiende a abrirse más de lo previsto. Las causas pueden incluir exceso de velocidad de entrada, una dirección brusca, saturación de los neumáticos delanteros al frenar o aplicar potencia demasiado pronto en algunas transmisiones.',
        },
        {
          heading: 'Sobreviraje',
          body: 'El sobreviraje ocurre cuando la parte trasera rota más de lo previsto en relación con la delantera. Puede deberse a levantar el pie de golpe, un trail braking excesivo, un acelerador agresivo, la saturación de los neumáticos traseros o un setup que favorece la rotación. Una rotación leve y controlada puede ser útil; un ángulo de deriva trasero que crece y exige mucho contravolante suele ser más lento y más riesgoso.',
        },
        {
          heading: 'La fase de la curva orienta el diagnóstico',
          body: 'El subviraje en la entrada suele apuntar a la velocidad, el frenado y el giro inicial. El subviraje a mitad de curva puede deberse a la trazada, el equilibrio o el agarre de los neumáticos. El subviraje a la salida puede reflejar el momento de acelerar o no haber abierto lo suficiente el volante. El sobreviraje en la entrada puede surgir de la liberación del freno o de la estabilidad trasera; el sobreviraje por potencia suele aparecer al acelerar. Son pistas, no diagnósticos definitivos.',
        },
        {
          heading: 'Acciones correctivas',
          body: 'Ante el subviraje, evita girar más el volante cuando el tren delantero ya está saturado; reduce la demanda y deja que los neumáticos se recuperen. Ante el sobreviraje, responde rápido con el contravolante adecuado y comandos de pedal medidos, evitando correcciones bruscas que provoquen un efecto péndulo. En un auto real, la recuperación debe practicarse con instrucción calificada y en un entorno controlado.',
        },
        {
          heading: 'Interpretar la telemetría',
          body: 'El ángulo de dirección, la velocidad, la velocidad de guiñada, la aceleración lateral, el acelerador y el freno ayudan a identificar un probable desequilibrio. Una velocidad de guiñada de referencia simplificada es la velocidad dividida por el radio de la trayectoria, pero el radio no se puede conocer con fiabilidad solo a partir de la guiñada. Comparar la guiñada real con un modelo del vehículo basado en la dirección y la velocidad solo es útil si está calibrado para la relación de dirección, la distancia entre ejes, el comportamiento de los neumáticos y las convenciones de signo. Una diferencia en la velocidad de guiñada, por sí sola, no prueba subviraje ni sobreviraje.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Revisa tres curvas con un coach de manejo o con la repetición. Etiqueta cada evento de comportamiento por fase y por su causa probable. Relaciona la observación con las curvas de pedales y dirección antes de cambiar el setup.',
        },
      ],
    },
    {
      id: 'connecting-corners',
      title: 'Enlazar curvas: optimizar una secuencia',
      summary: 'Una vuelta es una secuencia, no una colección de récords por curva.',
      figureTitle: 'Chicana: prioriza dónde termina el auto',
      sections: [
        {
          heading: 'Optimiza la secuencia',
          body: 'Una vuelta no es una colección de récords independientes por curva. La salida de una curva establece las condiciones de entrada de la siguiente. En una chicana o una serie de eses, un primer ápice agresivo puede dejar el auto mal colocado para la última curva y la recta siguiente.',
        },
        {
          heading: 'Prioriza la última salida',
          body: 'Si la última curva da a una recta larga, trabaja hacia atrás desde la posición y la dirección ideales de salida. Eso puede requerir una primera curva conservadora, una trazada inicial menos marcada o una transición de dirección más temprana. El compromiso correcto depende de la separación entre curvas, la velocidad, la forma de los pianos y la respuesta del auto.',
        },
        {
          heading: 'Cambios de dirección',
          body: 'Las transiciones rápidas exigen un manejo preciso de la carga. Un cambio brusco de dirección izquierda-derecha puede generar una fuerte transferencia de carga lateral y desestabilizar la parte trasera. Una dirección suave y decidida y un equilibrio adecuado del acelerador mantienen el auto estable y minimizan la distancia innecesaria.',
        },
        {
          heading: 'El tráfico cambia la respuesta',
          body: 'En carrera, la trazada más rápida en solitario puede no estar disponible. Defender la posición, adelantar y las entradas comprometidas exigen otras prioridades. Deja margen suficiente para adaptarte a los demás autos, sobre todo al frenar o girar lado a lado.',
        },
        {
          heading: 'Ejercicio práctico',
          kind: 'drill',
          body: 'Compara dos trazadas en un complejo de dos curvas. Registra el tiempo total desde la primera marca de frenado hasta un punto posterior a la última salida. Ignora qué curva individual se siente más rápida; juzga la secuencia completa.',
        },
      ],
    },
    {
      id: 'practice-and-telemetry',
      title: 'Ponerlo todo junto: práctica y telemetría',
      summary: 'Primero la consistencia; luego mide, cambia una cosa y repite.',
      figureTitle: 'Superponer curvas muestra dónde se generan las diferencias de velocidad',
      sections: [
        {
          heading: 'Consistencia antes que ataque máximo',
          body: 'Un piloto no puede identificar mejoras con fiabilidad si la variación entre vueltas es mayor que el cambio de técnica que está probando. Empieza con una base estable: el mismo auto, la misma configuración de pista, condiciones de neumáticos y supuestos de combustible, en lo posible. Haz vueltas repetibles a un ritmo que te deje atención suficiente para observar lo que hace el auto.',
        },
        {
          heading: 'Una jerarquía útil de telemetría',
          body: 'Empieza por la velocidad en función de la distancia, porque muestra dónde se pierde tiempo. Luego revisa la presión y la liberación del freno, el momento y la progresión del acelerador, la demanda de dirección y las aceleraciones disponibles. Superpone vueltas comparables alineadas por distancia. La marca de frenado de un piloto más rápido no es necesariamente el objetivo correcto si su trazada o su velocidad de entrada a la curva son distintas.',
        },
        {
          heading: 'Mide resultados completos',
          body: 'Entre las métricas útiles de una curva están la velocidad de entrada, el inicio del frenado, la presión máxima de freno, la distancia de liberación del freno, la velocidad mínima, el momento de volver al acelerador, el punto de acelerador a fondo, la velocidad de salida y el tiempo total del tramo. La distancia en vacío (sin pedales) y la superposición de freno y acelerador pueden dar contexto, pero ninguna es mala en sí misma: un breve tramo en vacío o una superposición pueden ser adecuados para un auto y una curva concretos.',
        },
        {
          heading: 'Un ciclo de mejora repetible',
          body: 'Observa un problema recurrente; formula una hipótesis; elige un solo cambio en los comandos; haz varias vueltas consistentes; compara la curva completa y la recta siguiente; conserva o descarta el cambio. Evita cambiar a la vez el setup, la marca de frenado, el ápice y la estrategia de acelerador, porque el resultado se vuelve difícil de interpretar.',
        },
        {
          heading: 'Plan de desarrollo en cuatro sesiones',
          body: 'Sesión 1: aprende las referencias y repite una trazada estable.\nSesión 2: afina la presión y la liberación del freno.\nSesión 3: mejora la posición en el ápice y la aceleración de salida.\nSesión 4: analiza la telemetría y concéntrate en las dos curvas con mayor pérdida de tiempo repetible.\nRepite el ciclo a medida que conoces mejor la pista.',
        },
        {
          heading: 'Principio final',
          kind: 'principle',
          body: 'La velocidad es el resultado de usar el agarre disponible con eficiencia, colocar el auto con precisión y hacer que cada comando prepare la siguiente fase de la vuelta. Maneja con intención, mide el resultado y cambia una cosa a la vez.',
        },
      ],
    },
  ],
  figures: {
    front: 'ADELANTE',
    rear: 'ATRÁS',
    brakingLoad: 'Frenada: carga al frente',
    acceleratingLoad: 'Aceleración: carga atrás',
    corneringLoad: ['En curva: carga a los', 'neumáticos exteriores'],
    accelerating: 'ACELERACIÓN',
    braking: 'FRENADO',
    turning: 'GIRO',
    tireLimit: 'Límite de fuerza del neumático (normalizado)',
    trailPath: 'Trayectoria ilustrativa de trail braking',
    progressThroughCorner: 'Avance en la curva',
    lateralPosition: 'Posición lateral (esquema)',
    geometricApex: 'Ápice geométrico',
    geometricArc: 'Arco geométrico',
    laterApexPath: 'Trazada de ápice tardío',
    brakingZoneDistance: 'Distancia en la zona de frenado (normalizada)',
    brakeCommand: 'Freno (%)',
    plannedThreshold: 'Frenado al límite planificado',
    lateAbrupt: 'Frenado tardío y brusco',
    cornerEntryProgression: 'Avance en la entrada a la curva',
    normalizedInput: 'Comando normalizado',
    brakePressure: 'Presión de freno (%)',
    steeringDemand: 'Demanda de dirección (relativa)',
    illustrativeSpeed: 'Velocidad (km/h ilustrativos)',
    entry: 'Entrada',
    apex: 'Ápice',
    exit: 'Salida',
    speed: 'Velocidad',
    distanceAfterCorner: 'Distancia después de la curva (m)',
    speedKmh: 'Velocidad (km/h)',
    driverA: 'Piloto A: salida más lenta',
    driverB: 'Piloto B: +5 km/h a la salida',
    cornerProgression: 'Avance en la curva',
    yawRate: 'Velocidad de guiñada (esquema)',
    referenceYaw: 'Respuesta de guiñada de referencia',
    underRotation: 'Poca rotación (posible subviraje)',
    overRotation: 'Exceso de rotación (posible sobreviraje)',
    twoCornerProgress: 'Avance en un complejo de dos curvas',
    balancedPath: 'Trazada equilibrada que prioriza la salida final',
    alternativePath: 'Trazada alternativa',
    normalizedCornerDistance: 'Distancia en la curva (normalizada)',
    currentLap: 'Vuelta actual',
    referenceLap: 'Vuelta de referencia',
  },
};
