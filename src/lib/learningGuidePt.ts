// The Learning page's guide in Brazilian Portuguese (the English original and the types are in learningGuide.ts)

import type { Guide } from '@/lib/learningGuide';

export const PT: Guide = {
  title: 'A arte de pilotar um carro de corrida',
  subtitle: 'Um guia prático e ilustrado para pilotos iniciantes e intermediários',
  topics: ['Dinâmica veicular', 'Traçado', 'Frenagem', 'Trail braking', 'Rotação', 'Telemetria'],
  note: 'Feito para o automobilismo em circuito fechado e para simuladores de corrida, com exemplos de GT3. Em veículos reais, as técnicas devem ser praticadas de forma progressiva e com supervisão qualificada.',
  chapters: [
    {
      id: 'race-car-dynamics',
      title: 'Entendendo a dinâmica de um carro de corrida',
      summary: 'Quatro áreas de contato, transferência de carga e de onde vem a aderência.',
      figureTitle: 'A transferência de carga muda a carga de cada pneu, não o peso total do carro',
      sections: [
        {
          heading: 'As quatro áreas de contato',
          body: 'Um carro de corrida interage com a pista por meio de quatro áreas de contato dos pneus relativamente pequenas. Toda força de frenagem, aceleração e curva passa, no fim das contas, por elas. O piloto não cria aderência ao mexer no volante ou apertar um pedal; ele pede forças que os pneus podem ou não ser capazes de produzir. O composto, a temperatura e a pressão dos pneus, a superfície da pista e a carga vertical influenciam o resultado.',
        },
        {
          heading: 'Transferência de carga',
          body: 'Na frenagem, a carga se transfere para o eixo dianteiro; na aceleração, para o traseiro; na curva, para os pneus externos. É uma transferência dinâmica de carga, não um deslocamento literal da massa total do carro. Mais carga sobre um pneu geralmente aumenta sua aderência absoluta, mas em geral menos que proporcionalmente, então grandes transferências de carga podem reduzir a soma da aderência disponível. Transições suaves deixam o carro mais fácil de controlar.',
        },
        {
          heading: 'Aderência mecânica e aerodinâmica',
          body: 'A aderência mecânica vem dos pneus, da suspensão, da superfície e da carga. O downforce aerodinâmico aumenta a carga vertical nos pneus com a velocidade, o que costuma fazer as curvas de alta se comportarem de forma diferente das de baixa. Um GT3 pode tolerar mais exigência de volante ou de freio em alta velocidade, mas o downforce diminui à medida que o carro desacelera. Nunca suponha que uma técnica eficaz numa curva rápida vai funcionar do mesmo jeito num grampo.',
        },
        {
          heading: 'Aplicação na pilotagem',
          body: 'Aborde cada curva com uma sequência clara: freie enquanto o carro está estável, introduza o volante de forma progressiva, equilibre o carro perto do ápice e desfaça o volante progressivamente enquanto acelera. Use um acerto repetível e condições de pneus constantes antes de julgar se um problema de comportamento é causado pelo piloto ou é mecânico.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Dê cinco voltas num ritmo confortável e foque apenas em transições suaves entre freio, volante e acelerador. Observe se o carro mergulha, levanta ou muda de direção de forma brusca. Suavidade não é lentidão: é o controle preciso da velocidade com que as forças dos pneus mudam.',
        },
      ],
    },
    {
      id: 'traction-circle',
      title: 'O círculo de tração: entendendo os limites de aderência',
      summary: 'Frear, acelerar e virar dividem um mesmo orçamento finito de força.',
      figureTitle: 'Círculo de tração: orçamento combinado de força do pneu',
      sections: [
        {
          heading: 'Um orçamento de força compartilhado',
          body: 'Um pneu pode gerar força longitudinal para frear ou acelerar e força lateral para virar. Essas demandas competem por uma capacidade finita. O círculo de tração é um modelo conceitual útil: se um pneu está perto da frenagem máxima em linha reta, sobra muito pouca força lateral adicional. Na prática, o limite costuma lembrar uma elipse e muda com a carga, a velocidade, a superfície e o estado do pneu.',
        },
        {
          heading: 'Combinando os comandos',
          body: 'Um piloto que entra numa curva em frenagem máxima precisa reduzir a força de frenagem à medida que a demanda de volante cresce. No ápice, a demanda lateral pode ser alta e a de acelerador, moderada. Na saída, o piloto reduz gradualmente o volante enquanto acrescenta acelerador. Essa troca coordenada de forças é a habilidade central da pilotagem de alto desempenho.',
        },
        {
          heading: 'O que o diagrama significa',
          body: 'A figura usa eixos de força normalizados; não é um mapa calibrado de nenhum pneu específico. Pontos dentro do limite representam combinações possíveis; pontos além dele indicam escorregamento, travamento de roda, atuação do ABS ou do controle de tração, ou alguma combinação disso. O limite real disponível é diferente em cada roda.',
        },
        {
          heading: 'Erro comum',
          kind: 'error',
          body: 'Iniciantes costumam pedir pressão total de freio e um grande ângulo de volante ao mesmo tempo. Outro erro comum é afundar o acelerador antes de desfazer o volante o suficiente. Ambos sobrecarregam o orçamento de força do pneu. A solução não é necessariamente um ritmo geral mais lento: é um timing e uma combinação melhores dos comandos.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Numa curva de média velocidade e regular, freie com firmeza em linha reta e depois reduza a pressão deliberadamente à medida que o volante aumenta. Repita com uma sobreposição pequena e controlada. Compare a estabilidade e a velocidade mínima, não apenas o quanto você consegue frear mais tarde.',
        },
      ],
    },
    {
      id: 'racing-line',
      title: 'O traçado: geometria e velocidade',
      summary: 'Fora–dentro–fora, pontos de referência e como escolher o ápice.',
      figureTitle: 'Traçados diferentes trocam raio de entrada por posição de saída',
      sections: [
        {
          heading: 'Comece pelo fora–dentro–fora',
          body: 'Usar toda a largura da pista pode aumentar o raio da curva, reduzindo a aceleração lateral necessária a uma dada velocidade. O traçado básico fora–dentro–fora é um ótimo ponto de partida: chegue aberto, vire em direção ao ápice e deixe o carro abrir na saída. A trajetória ideal depende da curva seguinte, da aderência, do tráfego, das zebras e do carro.',
        },
        {
          heading: 'Pontos de referência',
          body: 'Escolha uma marca de frenagem, um ponto de tomada de curva, uma referência de ápice e um alvo de saída. Uma boa referência é fixa e visível: uma placa, uma emenda no asfalto, o início de uma zebra ou um posto de fiscal. Evite sombras e objetos temporários. Olhe para a próxima referência antes de chegar à atual, em vez de fixar o olhar no para-choque dianteiro.',
        },
        {
          heading: 'Ápice antecipado e ápice tardio',
          body: 'Um ápice antecipado pode forçar o carro a abrir demais na saída e atrasar o acelerador. Um ápice mais tardio costuma sacrificar um pouco de velocidade de entrada para melhorar a orientação e a aceleração na saída, principalmente antes de uma reta longa. Nenhum dos dois é mais rápido em todos os casos. O ápice geométrico é apenas uma geometria inicial útil, não uma regra.',
        },
        {
          heading: 'Combinações de curvas',
          body: 'O traçado mais rápido numa curva pode comprometer a seguinte. Numa sequência esquerda-direita, pode valer a pena sair da primeira curva pelo lado que prepara a segunda. Trate curvas encadeadas como um único problema de otimização, com atenção especial à saída final.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Escolha uma curva e faça três traçados repetíveis: ápice levemente antecipado, neutro e levemente tardio. Compare o tempo do trecho da curva e a velocidade 100–200 metros depois da saída. Respeite os limites de pista e faça mudanças pequenas o bastante para conseguir interpretá-las.',
        },
      ],
    },
    {
      id: 'braking',
      title: 'Frenagem: onde o tempo de volta é ganho ou perdido',
      summary: 'Frenagem no limite, a liberação do freio e como medir uma zona de frenagem.',
      figureTitle: 'Curvas ilustrativas de pressão de freio',
      sections: [
        {
          heading: 'Frear é uma sequência',
          body: 'Uma zona de frenagem de qualidade inclui a aplicação inicial do pedal, a desaceleração máxima, uma liberação controlada e a transição para o volante. O ponto de frenagem correto depende da velocidade de chegada, da inclinação, da aderência dos pneus, do downforce, do combustível e da velocidade de entrada na curva necessária. Frear mais tarde só é mais rápido se o carro ainda chegar à velocidade e à posição certas para a tomada de curva.',
        },
        {
          heading: 'Frenagem no limite',
          body: 'A frenagem no limite (threshold braking) busca usar a aderência longitudinal disponível dos pneus sem travamentos descontrolados. Aumente a pressão rapidamente, mas de forma progressiva o bastante para evitar um pico que desestabilize o carro. À medida que a velocidade cai, a carga aerodinâmica pode diminuir, mudando a pressão admissível. Num GT3 com ABS, pode haver breves atuações do ABS; uma atuação forte e prolongada pode indicar excesso de demanda ou um perfil de pressão ruim.',
        },
        {
          heading: 'A liberação do freio importa',
          body: 'Soltar o pedal de forma abrupta pode mudar a carga na dianteira e atrapalhar a transição para o volante. Uma liberação controlada permite que o carro rotacione de forma previsível. Muitos pilotos intermediários ganham mais tempo melhorando a liberação do freio do que atrasando o ponto de frenagem em vários metros.',
        },
        {
          heading: 'Medindo a frenagem',
          body: 'Use a pressão de freio, a velocidade, a aceleração longitudinal e a distância. Compare onde a frenagem começa, a pressão máxima, a rapidez com que a velocidade cai e onde a pressão chega a zero. Um ponto de frenagem tardio com um ápice lento ou uma saída comprometida não é uma melhora. Ao analisar a telemetria, diferencie a posição do pedal da pressão real de freio.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Mantenha a marca de frenagem fixa por cinco voltas. Primeiro melhore o formato da pressão e a liberação. Depois ajuste a marca em pequenos incrementos, conferindo a posição no ápice e a velocidade de saída. Nunca experimente frenagens máximas no tráfego ou num ambiente sem controle.',
        },
      ],
    },
    {
      id: 'trail-braking',
      title: 'Trail braking: controlando a rotação na entrada da curva',
      summary: 'Trocar pressão de freio por volante para controlar a velocidade de entrada e a rotação.',
      figureTitle: 'Trail braking: alivie o freio à medida que a demanda de volante aumenta',
      sections: [
        {
          heading: 'Definição',
          body: 'Trail braking significa levar uma pressão de freio decrescente para além do início da tomada de curva. Em vez de terminar a frenagem antes de começar a virar, o piloto sobrepõe as duas coisas enquanto troca demanda longitudinal do pneu por demanda lateral. A técnica pode ajudar a controlar a velocidade de entrada e a influenciar a facilidade com que o carro rotaciona.',
        },
        {
          heading: 'Por que funciona',
          body: 'A desaceleração muda as cargas nos pneus e as forças disponíveis. Manter alguma pressão de freio pode preservar a carga na dianteira enquanto os pneus traseiros talvez tenham menos reserva lateral, o que afeta a resposta de guinada. O efeito exato depende da distribuição de frenagem, do comportamento do diferencial, das características dos pneus, da velocidade e do acerto. O trail braking não garante mais aderência na dianteira nem rotação automática.',
        },
        {
          heading: 'O perfil de liberação',
          body: 'Comece com uma fase de frenagem estável e quase reta. À medida que o volante aumenta, reduza a pressão do freio com suavidade. Evite manter a pressão máxima de freio até muito dentro de uma curva fechada. O objetivo não é uma quantidade predeterminada de sobreposição; é uma transição equilibrada e repetível que deixe o carro seguir o traçado pretendido.',
        },
        {
          heading: 'Quando não forçar',
          body: 'Curvas muito rápidas, ondulações, lombadas, condições de pouca aderência e uma traseira instável podem exigir liberar o freio mais cedo ou uma abordagem mais conservadora. Algumas curvas são mais bem resolvidas com frenagem em linha reta seguida de uma tomada de curva limpa. Se a traseira começar a rotacionar rápido demais, reduza a demanda combinada e priorize estabilizar o carro.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Numa curva de média velocidade que perdoe erros, compare uma liberação limpa em linha reta com uma pequena quantidade de pressão mantida. Analise as curvas de freio e volante, a velocidade mínima, a resposta de guinada e a qualidade da saída. Mude uma variável de cada vez.',
        },
      ],
    },
    {
      id: 'cornering',
      title: 'Técnica de curva: entrada, ápice e saída',
      summary: 'Uma única manobra contínua: estabeleça a plataforma, equilibre, abra o volante.',
      figureTitle: 'Fases da curva e a região de velocidade mínima',
      sections: [
        {
          heading: 'Entrada: estabeleça a plataforma',
          body: 'A entrada começa antes da tomada de curva. O piloto escolhe um ponto de frenagem, chega a uma velocidade adequada e posiciona o carro para conseguir um raio administrável. Olhar à frente é essencial: a atenção visual deve avançar da tomada de curva para o ápice e depois para a saída. Exagerar na entrada costuma aumentar a demanda de volante e pode atrasar a aceleração.',
        },
        {
          heading: 'Meio da curva: equilíbrio',
          body: 'Perto do ápice, o volante e a aceleração lateral costumam ser consideráveis. Um carro equilibrado pode precisar de acelerador de manutenção, uma leve aliviada ou nenhum acelerador, dependendo da curva e do acerto. O objetivo nem sempre é maximizar a velocidade mínima; é levar a velocidade que permita o melhor tempo total do trecho.',
        },
        {
          heading: 'Saída: abra o volante',
          body: 'À medida que o carro rotaciona em direção à saída, comece a reduzir a demanda de volante e a acrescentar acelerador de forma progressiva. O orçamento de força do pneu permite mais aceleração conforme a demanda lateral diminui. A abertura na saída deve ser deliberada e previsível, e não a consequência de ficar sem aderência na dianteira.',
        },
        {
          heading: 'Um modelo mental útil',
          body: 'Pense na curva como uma única manobra contínua, e não como três ações separadas. Uma liberação do freio tardia ou abrupta afeta o equilíbrio no ápice; a posição no ápice afeta quando o volante pode ser desfeito; e isso afeta quão cedo a potência total fica disponível. As fases são rótulos para a análise, não fronteiras bruscas entre comandos.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Identifique quatro referências numa única curva: freio, tomada, ápice, saída. Faça o carro passar por cada uma de forma consistente antes de tentar aumentar a velocidade. Analise o vídeo ou a telemetria para encontrar a primeira fase em que aparece um erro.',
        },
      ],
    },
    {
      id: 'exit-speed',
      title: 'Velocidade de saída: transformando boas curvas em voltas rápidas',
      summary: 'Por que a vantagem de velocidade na saída continua rendendo por toda a reta.',
      figureTitle: 'A vantagem de velocidade na saída se mantém na reta',
      sections: [
        {
          heading: 'Por que as saídas importam',
          body: 'Uma vantagem de velocidade na saída se mantém ao longo da reta seguinte e pode gerar um ganho de tempo muito maior do que o da própria curva. Um piloto que chega antes ao acelerador total, com o carro mais bem orientado, pode continuar ganhando distância. O efeito é especialmente valioso antes de retas longas, embora o ganho exato dependa da aceleração e do arrasto.',
        },
        {
          heading: 'Mais cedo nem sempre é melhor',
          body: 'O primeiro instante de acelerador não é o mesmo que uma aceleração efetiva. Acelerar cedo demais pode causar patinagem, atuação do controle de tração, subesterço de potência ou uma saída mais aberta que obrigue a aliviar. A métrica útil é quanta aceleração se consegue mantendo o traçado desejado.',
        },
        {
          heading: 'Troque entrada por saída',
          body: 'Numa curva lenta que leva a uma reta longa, uma entrada um pouco mais lenta ou um ápice mais tardio pode permitir desfazer o volante mais cedo e acelerar com mais força. O piloto pode perder um pouco de tempo na entrada e ganhar mais na saída. Confirme isso com o tempo do trecho e as curvas de velocidade, em vez de supor que um ápice tardio sempre vence.',
        },
        {
          heading: 'Leia as métricas certas',
          body: 'Compare a velocidade numa marca fixa de saída, a progressão do acelerador, o ângulo de volante e a velocidade 100 ou 200 metros depois. Quando possível, compare na mesma marcha, com a mesma carga de combustível, o mesmo estado dos pneus e as mesmas condições de pista. A velocidade de saída numa marca específica diz mais do que um valor isolado de velocidade máxima.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Escolha a curva lenta antes da reta mais longa. Faça pequenas mudanças no timing do ápice e na progressão do acelerador. Classifique as voltas pelo tempo desde a tomada de curva até um ponto fixo bem adiante na reta, e não apenas pela velocidade no ápice.',
        },
      ],
    },
    {
      id: 'understeer-oversteer',
      title: 'Subesterço e sobre-esterço: entendendo a rotação',
      summary: 'Reconhecer o desequilíbrio pela fase da curva e como reagir.',
      figureTitle: 'Comparar a guinada exige velocidade, volante e contexto',
      sections: [
        {
          heading: 'Subesterço',
          body: 'O subesterço (saída de frente) acontece quando o carro vira menos do que o pedido: os pneus dianteiros não conseguem dar resposta lateral suficiente em relação aos traseiros. O carro tende a abrir mais do que o pretendido. As causas podem incluir velocidade de entrada excessiva, volante brusco, saturação dos pneus dianteiros na frenagem ou acelerar cedo demais em algumas trações.',
        },
        {
          heading: 'Sobre-esterço',
          body: 'O sobre-esterço (saída de traseira) acontece quando a traseira rotaciona mais do que o pretendido em relação à dianteira. Pode resultar de tirar o pé de forma abrupta, trail braking excessivo, acelerador agressivo, saturação dos pneus traseiros ou um acerto que favorece a rotação. Uma rotação leve e controlada pode ser útil; um ângulo de deriva traseiro que cresce e exige muito contraesterço costuma ser mais lento e mais arriscado.',
        },
        {
          heading: 'A fase da curva orienta o diagnóstico',
          body: 'Subesterço na entrada costuma apontar para velocidade, frenagem e tomada de curva. Subesterço no meio da curva pode envolver traçado, equilíbrio ou aderência dos pneus. Subesterço na saída pode refletir o timing do acelerador ou volante pouco desfeito. Sobre-esterço na entrada pode vir da liberação do freio ou da estabilidade traseira; o sobre-esterço de potência normalmente aparece durante a aceleração. São pistas, não diagnósticos definitivos.',
        },
        {
          heading: 'Ações corretivas',
          body: 'No subesterço, evite acrescentar mais volante quando a dianteira já está saturada; reduza a demanda e deixe os pneus se recuperarem. No sobre-esterço, reaja prontamente com o contraesterço adequado e comandos de pedal medidos, evitando correções bruscas que provoquem um efeito pêndulo. Num carro real, a recuperação deve ser praticada com instrução qualificada e num ambiente controlado.',
        },
        {
          heading: 'Interpretando a telemetria',
          body: 'Ângulo de volante, velocidade, taxa de guinada, aceleração lateral, acelerador e freio ajudam a identificar um provável desequilíbrio. Uma taxa de guinada de referência simplificada é a velocidade dividida pelo raio da trajetória, mas o raio não pode ser conhecido com confiabilidade apenas pela guinada. Comparar a guinada real com um modelo do veículo baseado em volante e velocidade só é útil quando ele está calibrado para a relação de direção, o entre-eixos, o comportamento dos pneus e as convenções de sinal. Uma diferença na taxa de guinada, sozinha, não prova subesterço nem sobre-esterço.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Analise três curvas com um coach de pilotagem ou pelo replay. Classifique cada evento de comportamento por fase e pela causa provável. Relacione a observação com as curvas de pedais e volante antes de mudar o acerto.',
        },
      ],
    },
    {
      id: 'connecting-corners',
      title: 'Encadeando curvas: otimizando uma sequência',
      summary: 'Uma volta é uma sequência, não uma coleção de recordes por curva.',
      figureTitle: 'Chicane: priorize onde o carro termina',
      sections: [
        {
          heading: 'Otimize a sequência',
          body: 'Uma volta não é uma coleção de recordes independentes por curva. A saída de uma curva define as condições de entrada da seguinte. Numa chicane ou numa sequência de esses, um primeiro ápice agressivo pode deixar o carro mal posicionado para a última curva e para a reta seguinte.',
        },
        {
          heading: 'Priorize a última saída',
          body: 'Se a última curva leva a uma reta longa, trabalhe de trás para a frente a partir da posição e da direção ideais de saída. Isso pode exigir uma primeira curva conservadora, um traçado inicial mais raso ou uma transição de volante mais cedo. O compromisso certo depende do espaçamento entre as curvas, da velocidade, do formato das zebras e da resposta do carro.',
        },
        {
          heading: 'Mudanças de direção',
          body: 'Transições rápidas exigem um controle preciso da carga. Uma inversão brusca de volante esquerda-direita pode criar uma forte transferência de carga lateral e desestabilizar a traseira. Um volante suave e decidido e um equilíbrio adequado do acelerador mantêm o carro estável e minimizam a distância desnecessária.',
        },
        {
          heading: 'O tráfego muda a resposta',
          body: 'Na corrida, o traçado mais rápido sozinho na pista pode não estar disponível. Defender posição, ultrapassar e entradas comprometidas exigem outras prioridades. Deixe margem suficiente para se adaptar aos outros carros, principalmente ao frear ou fazer curvas lado a lado.',
        },
        {
          heading: 'Exercício prático',
          kind: 'drill',
          body: 'Compare dois traçados num complexo de duas curvas. Registre o tempo total desde a primeira marca de frenagem até um ponto depois da última saída. Ignore qual curva individual parece mais rápida; julgue a sequência completa.',
        },
      ],
    },
    {
      id: 'practice-and-telemetry',
      title: 'Juntando tudo: prática e telemetria',
      summary: 'Primeiro a consistência; depois meça, mude uma coisa e repita.',
      figureTitle: 'Sobrepor curvas mostra onde surgem as diferenças de velocidade',
      sections: [
        {
          heading: 'Consistência antes do ataque máximo',
          body: 'Um piloto não consegue identificar melhoras com confiabilidade se a variação entre voltas for maior do que a mudança de técnica que está testando. Comece com uma base estável: mesmo carro, mesma configuração de pista, condições de pneus e premissas de combustível, sempre que possível. Faça voltas repetíveis num ritmo que deixe atenção suficiente para observar o que o carro está fazendo.',
        },
        {
          heading: 'Uma hierarquia útil de telemetria',
          body: 'Comece pela velocidade em função da distância, porque ela mostra onde o tempo é perdido. Depois analise a pressão e a liberação do freio, a retomada e a progressão do acelerador, a demanda de volante e as acelerações disponíveis. Sobreponha voltas comparáveis alinhadas pela distância. A marca de frenagem de um piloto mais rápido não é necessariamente o alvo certo se o traçado ou a velocidade de entrada na curva dele forem diferentes.',
        },
        {
          heading: 'Meça resultados completos',
          body: 'Métricas úteis de curva incluem velocidade de entrada, início da frenagem, pressão máxima de freio, distância de liberação do freio, velocidade mínima, retomada do acelerador, ponto de acelerador total, velocidade de saída e tempo total do trecho. A distância em vazio (sem pedais) e a sobreposição de freio e acelerador podem dar contexto, mas nenhuma delas é ruim por si só: um breve trecho em vazio ou uma sobreposição podem ser adequados para um carro e uma curva específicos.',
        },
        {
          heading: 'Um ciclo de melhora repetível',
          body: 'Observe um problema recorrente; formule uma hipótese; escolha uma única mudança de comando; faça várias voltas consistentes; compare a curva completa e a reta seguinte; mantenha ou descarte a mudança. Evite mudar ao mesmo tempo o acerto, a marca de frenagem, o ápice e a estratégia de acelerador, porque o resultado fica difícil de interpretar.',
        },
        {
          heading: 'Plano de evolução em quatro sessões',
          body: 'Sessão 1: aprenda as referências e repita um traçado estável.\nSessão 2: refine a pressão e a liberação do freio.\nSessão 3: melhore a posição no ápice e a aceleração de saída.\nSessão 4: analise a telemetria e foque nas duas curvas com a maior perda de tempo repetível.\nRepita o ciclo à medida que você conhece melhor a pista.',
        },
        {
          heading: 'Princípio final',
          kind: 'principle',
          body: 'Velocidade é o resultado de usar a aderência disponível com eficiência, posicionar o carro com precisão e fazer cada comando servir à próxima fase da volta. Pilote com intenção, meça o resultado e mude uma coisa de cada vez.',
        },
      ],
    },
  ],
  figures: {
    front: 'FRENTE',
    rear: 'TRASEIRA',
    brakingLoad: 'Frenagem: carga na frente',
    acceleratingLoad: 'Aceleração: carga atrás',
    corneringLoad: ['Em curva: carga para', 'os pneus externos'],
    accelerating: 'ACELERAÇÃO',
    braking: 'FRENAGEM',
    turning: 'CURVA',
    tireLimit: 'Limite de força do pneu (normalizado)',
    trailPath: 'Trajetória ilustrativa de trail braking',
    progressThroughCorner: 'Avanço na curva',
    lateralPosition: 'Posição lateral (esquema)',
    geometricApex: 'Ápice geométrico',
    geometricArc: 'Arco geométrico',
    laterApexPath: 'Traçado de ápice tardio',
    brakingZoneDistance: 'Distância na zona de frenagem (normalizada)',
    brakeCommand: 'Freio (%)',
    plannedThreshold: 'Frenagem no limite planejada',
    lateAbrupt: 'Frenagem tardia e abrupta',
    cornerEntryProgression: 'Avanço na entrada da curva',
    normalizedInput: 'Comando normalizado',
    brakePressure: 'Pressão de freio (%)',
    steeringDemand: 'Demanda de volante (relativa)',
    illustrativeSpeed: 'Velocidade (km/h ilustrativos)',
    entry: 'Entrada',
    apex: 'Ápice',
    exit: 'Saída',
    speed: 'Velocidade',
    distanceAfterCorner: 'Distância após a curva (m)',
    speedKmh: 'Velocidade (km/h)',
    driverA: 'Piloto A: saída mais lenta',
    driverB: 'Piloto B: +5 km/h na saída',
    cornerProgression: 'Avanço na curva',
    yawRate: 'Taxa de guinada (esquema)',
    referenceYaw: 'Resposta de guinada de referência',
    underRotation: 'Pouca rotação (possível subesterço)',
    overRotation: 'Rotação excessiva (possível sobre-esterço)',
    twoCornerProgress: 'Avanço num complexo de duas curvas',
    balancedPath: 'Traçado equilibrado priorizando a saída final',
    alternativePath: 'Traçado alternativo',
    normalizedCornerDistance: 'Distância na curva (normalizada)',
    currentLap: 'Volta atual',
    referenceLap: 'Volta de referência',
  },
};
