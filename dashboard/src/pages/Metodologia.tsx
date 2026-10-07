import { L, getLang } from "../lib/i18n";

export function Metodologia() {
  if (getLang() === "en") return <MetodologiaEn />;
  return (
    <article className="flex max-w-3xl flex-col gap-4 leading-relaxed">
      <div className="eyebrow">Metodologia</div>
      <h1 className="display text-3xl">De onde vêm estes números</h1>
      <h2 className="display text-xl">Votos</h2>
      <p>
        Os votos foram lidos diretamente dos <b>Boletins de Urna (BU)</b> de todas as seções eleitorais de São Paulo, Minas
        Gerais e Rio Grande do Sul, publicados pelo TSE em resultados.tse.jus.br (1º turno, 4/10/2026). A soma das seções foi
        conferida com o resultado oficial do TSE por zona, município e estado: a diferença é zero para todas as candidaturas e legendas.
      </p>
      <p>
        "% dos válidos" é a votação dividida pelos votos válidos do mesmo cargo no recorte (votos nominais e de legenda
        com destinação válida, de todos os partidos). Votos em candidaturas indeferidas contam como nulos técnicos.
      </p>
      <h2 className="display text-xl">Local de votação, bairro e escola</h2>
      <p>
        Cada seção foi associada ao seu local de votação pelo cadastro oficial do TSE
        (<i>eleitorado_local_votacao_2026</i>, Portal de Dados Abertos), que traz escola, endereço, bairro e coordenadas.
        O <b>bairro é o do local de votação</b>, como grafado pelo TSE: não é o bairro onde o eleitor mora nem um limite
        oficial de bairro. Locais sem coordenada válida no cadastro foram posicionados num ponto interno do município.
      </p>
      <h2 className="display text-xl">Modos do mapa</h2>
      <ul className="list-disc pl-5">
        <li><b>Escolas</b>: um círculo por local de votação; área proporcional aos votos.</li>
        <li><b>Territórios</b>: cada ponto do município é atribuído ao local de votação mais próximo (polígonos de Voronoi recortados pelo limite municipal do IBGE). É uma aproximação geográfica, não a área real de residência dos eleitores.</li>
        <li><b>Municípios</b>, <b>Hexágonos</b> e <b>Calor</b>: agregações dos locais para leitura em escala estadual.</li>
        <li>As cores usam quantis: cada faixa da legenda tem aproximadamente o mesmo número de áreas.</li>
      </ul>
      <h2 className="display text-xl">Publicidade (Biblioteca de Anúncios da Meta)</h2>
      <ul className="list-disc pl-5">
        <li><b>Coleta</b>: API oficial <code>ads_archive</code> (Graph API v26.0), anúncios políticos veiculados desde 16/08/2026 pelas
          páginas das candidaturas eleitas de SP, MG e RS (e da Manuela). Sem raspagem de tela.</li>
        <li><b>Página ↔ candidatura</b>: confirmada quando o financiador declarado é o CNPJ de campanha ("ELEIÇÃO 2026 + nome completo
          no TSE"). Casos de nome social ou financiador fora do padrão ficam como vínculo a revisar, sinalizados na página.</li>
        <li><b>Segmentação ≠ entrega ≠ votação</b>: as cidades e bairros são os escolhidos pelo anunciante; a entrega informada pela
          Meta só existe por estado; o cruzamento com votos é descritivo, não mede efeito dos anúncios.</li>
        <li><b>Gasto e impressões</b> são faixas acumuladas por anúncio; somam-se os limites, sem ponto médio. Alcance não se soma.
          O gasto de um anúncio com várias cidades nunca é dividido entre elas.</li>
        <li><b>Dobradas pagas</b>: anúncio pago por uma campanha (financiador = CNPJ de campanha) que traz o nome e o número de urna de
          outra candidatura. O gasto é de quem pagou. Só contam anúncios segmentados para o estado da candidatura citada (evita homônimos de outros estados, como a Bancada Feminista do PSOL do Piauí); menções só pelo nome, sem número, ficam como não confirmadas.</li>
        <li><b>Candidaturas sem tráfego próprio</b> (caso da Manuela D'Ávila): nenhuma página delas anunciou. O que aparece são
          anúncios de outras campanhas que escolheram usar o nome e o número da candidatura; o painel os chama de "anúncios de
          terceiros", o gasto é de quem pagou e nada disso é gasto da candidatura.</li>
        <li><b>Temas dos criativos</b>: classificação por termos, sem IA, em três eixos (políticas públicas, função eleitoral, como fala),
          revisada sobre os 110 mil anúncios coletados. Unidade: criativo distinto (o mesmo texto chega a centenas de anúncios, um por
          cidade). Rodapés legais (CNPJ, federação) são removidos antes; termos casam no começo de palavra. A verba por tema é dividida
          entre os temas de política de cada anúncio. A classificação lê só o texto: quando a maior parte dos criativos é só pedido de
          voto (a mensagem está no vídeo), o card avisa.</li>
      </ul>
      <h2 className="display text-xl">Apocalipse (esquerda × centrão × extrema direita)</h2>
      <ul className="list-disc pl-5">
        <li><b>Blocos por partido</b>: esquerda = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; centrão = PP, Republicanos,
          União, MDB, PSD, Podemos, PRD, Solidariedade, Avante, Agir, Mobiliza; extrema direita = PL, NOVO, MISSÃO, DC; demais = PSDB,
          Cidadania, Democrata e outros. O centrão segue o survey com 379 cientistas políticos da ABCP (
          <a className="text-accent" href="https://congressoemfoco.com.br/coluna/37360/afinal-que-partidos-integram-o-centrao-pesquisa-inedita-aponta" target="_blank" rel="noreferrer">Testa, Mesquita &amp; Bolognesi, Cadernos CRH, 2024</a>
          ), que também inclui o PL; aqui o PL fica na extrema direita pelo alinhamento bolsonarista (
          <a className="text-accent" href="https://scielo.br/j/dados/a/zzyM3gzHD4P45WWdytXjZWg/?format=pdf" target="_blank" rel="noreferrer">Bolognesi, Ribeiro &amp; Codato, Dados, 2023</a>
          ). PTB e Patriota viraram PRD; Solidariedade, Avante, Agir e Mobiliza entram pelo mesmo perfil. A classificação pode ser
          alterada na página e fica salva no navegador.</li>
        <li><b>Classificação por candidatura</b>, por cima do partido, para bolsonaristas fora do PL. Duas regras, nesta ordem: (1) curadoria
          com fonte pública (apoio declarado da família Bolsonaro ou ex-integrante do governo Bolsonaro; defesa da anistia aos réus do 8 de
          janeiro ou ataques ao processo eleitoral; trajetória bolsonarista recorrente na imprensa; moção ou bancada bolsonarista na
          Assembleia); (2) quem era deputado federal e votou Sim na urgência da anistia (
          <a className="text-accent" href="https://dadosabertos.camara.leg.br/api/v2/votacoes/2562149-7/votos" target="_blank" rel="noreferrer">Câmara, 17/09/2025, 311 a 163</a>
          ), cruzado com o TSE pelo nome civil. Na dúvida, fica o partido. A tabela da página mostra cada caso com critério, evidência e
          fonte; a chave pode ser desligada.</li>
        <li><b>Números</b>: votos nominais + legenda por cidade, partido e cargo (TSE); eleitos e 2º turno pela situação do TSE; tráfego
          pago e temas só das candidaturas eleitas (as únicas coletadas), com custo por mil alcançados = Σ gasto ÷ Σ alcance × 1.000.
          Gasto por voto não mede efeito: quem anuncia mais costuma já ser mais forte.</li>
      </ul>
      <h2 className="display text-xl">Ainda há esperança (2º turno)</h2>
      <ul className="list-disc pl-5">
        <li><b>Saldo potencial</b> de um território = 10% dos abstencionistas × (válidos ÷ comparecimento) × (% Lula − % adversário),
          supondo que quem passa a votar vota como quem já votou ali. É uma régua para ordenar prioridades, não uma previsão: a abstenção
          tende a ser maior entre os mais pobres e os mais jovens, o que costuma favorecer Lula, mas não há dado individual.</li>
        <li><b>Faixas</b>: "mobilizar" = Lula à frente por 10 p.p. ou mais, ou à frente com abstenção acima da mediana dos locais;
          "disputar" = margem de até 10 p.p.; "conter" = adversário à frente por mais de 10 p.p. (campanha de comparecimento ali ajuda
          o adversário).</li>
        <li><b>Bairro</b> é o do local de votação (ver acima); só entram bairros com 500 ou mais eleitores. "Base forte" de uma
          candidatura = bairros em que ela teve 1,2× ou mais a sua média estadual e 100 ou mais votos. Prioridade por candidatura =
          saldo potencial × força relativa (limitada a 3×). Os cards do Apocalipse usam exatamente este cálculo.</li>
      </ul>
      <h2 className="display text-xl">Evolução digital (MG)</h2>
      <ul className="list-disc pl-5">
        <li>16 candidaturas a deputado estadual do monitoramento de setembro, ligadas ao TSE pelo número de urna, cargo e UF.</li>
        <li>Seguidores observados em 01, 04, 06, 13 e 20/09 (histórico) e no snapshot atual pela Apify; só datas observadas, sem curva
          diária inventada; plataformas separadas; seguidores não são eleitores nem votos.</li>
        <li>Postagens do Instagram desde 16/08: curtidas e comentários acumulados até a coleta; sem taxa de engajamento.</li>
      </ul>
      <h2 className="display text-xl">Fontes</h2>
      <p className="text-sm text-muted">
        TSE (Boletins de Urna, resultados oficiais e cadastro de locais de votação) · IBGE (malhas municipais) ·
        Fundo de mapa: OpenFreeMap / © OpenStreetMap.
      </p>
    </article>
  );
}

function MetodologiaEn() {
  return (
    <article className="flex max-w-3xl flex-col gap-4 leading-relaxed">
      <div className="eyebrow">{L("Metodologia", "Methodology")}</div>
      <h1 className="display text-3xl">Where these numbers come from</h1>
      <h2 className="display text-xl">Votes</h2>
      <p>
        Votes were read directly from the <b>ballot-box reports (Boletins de Urna, BU)</b> of every polling section in São Paulo,
        Minas Gerais and Rio Grande do Sul, published by the TSE (Superior Electoral Court) at resultados.tse.jus.br (1st round, October 4, 2026). The sum of the sections was
        checked against the TSE's official results by electoral zone, municipality and state: the difference is zero for every candidacy
        and party.
      </p>
      <p>
        "% of valid votes" is the vote count divided by the valid votes for the same office in the selected area (candidate and party
        votes with a valid destination, across all parties). Votes for candidacies that were rejected by the electoral courts count as
        technically null.
      </p>
      <h2 className="display text-xl">Polling place, neighborhood and school</h2>
      <p>
        Each section was matched to its polling place using the TSE's official registry
        (<i>eleitorado_local_votacao_2026</i>, Open Data Portal), which lists the school, address, neighborhood and coordinates.
        The <b>neighborhood is that of the polling place</b>, as spelled by the TSE: it is not the neighborhood where the voter lives,
        nor an official neighborhood boundary. Polling places without valid coordinates in the registry were placed at a point inside
        the municipality.
      </p>
      <h2 className="display text-xl">Map modes</h2>
      <ul className="list-disc pl-5">
        <li><b>Schools</b>: one circle per polling place; area proportional to votes.</li>
        <li><b>Territories</b>: every point in the municipality is assigned to the nearest polling place (Voronoi polygons clipped to the IBGE municipal boundary). This is a geographic approximation, not the actual area where voters live.</li>
        <li><b>Municipalities</b>, <b>Hexagons</b> and <b>Heat</b>: aggregations of polling places for reading at the state scale.</li>
        <li>Colors use quantiles: each legend band contains roughly the same number of areas.</li>
      </ul>
      <h2 className="display text-xl">Paid ads (Meta Ad Library)</h2>
      <ul className="list-disc pl-5">
        <li><b>Collection</b>: the official <code>ads_archive</code> API (Graph API v26.0), political ads run since August 16, 2026 by the
          pages of the elected candidacies in SP, MG and RS (and Manuela's). No screen scraping.</li>
        <li><b>Page ↔ candidacy</b>: confirmed when the declared funder is the campaign's CNPJ (tax ID) ("ELEIÇÃO 2026 + full name
          at the TSE"). Cases with a social name or a non-standard funder remain as links to be reviewed, flagged on the page.</li>
        <li><b>Targeting ≠ delivery ≠ votes</b>: cities and neighborhoods are those chosen by the advertiser; the delivery reported by
          Meta exists only by state; the comparison with votes is descriptive and does not measure the effect of the ads.</li>
        <li><b>Spend and impressions</b> are cumulative ranges per ad; the range bounds are added up, with no midpoint. Reach is not
          added up. The spend of an ad targeting several cities is never split among them.</li>
        <li><b>Paid joint tickets</b>: an ad paid for by one campaign (funder = campaign CNPJ) that shows the name and ballot number of
          another candidacy. The spend belongs to whoever paid. Only ads targeting the mentioned candidacy's state count (this avoids namesakes from other states, such as the PSOL Feminist Caucus of Piauí); name-only mentions, without the ballot number, remain unconfirmed.</li>
        <li><b>Candidacies with no paid ads of their own</b> (Manuela D'Ávila's case): none of their pages advertised. What shows up are
          ads by other campaigns that chose to use the candidacy's name and ballot number; the dashboard calls them "third-party ads",
          the spend belongs to whoever paid, and none of it is the candidacy's spend.</li>
        <li><b>Creative themes</b>: keyword-based classification, without AI, along three axes (public policy, electoral function,
          tone), reviewed over the 110 thousand ads collected. Unit: distinct creative (the same text can reach hundreds of ads, one per
          city). Legal footers (CNPJ, federation) are removed first; terms match at the start of words. Spend per theme is split among
          the policy themes of each ad. The classification reads text only: when most creatives are just a vote request (the message is
          in the video), the card says so.</li>
      </ul>
      <h2 className="display text-xl">Apocalypse (left × centrão × far right)</h2>
      <ul className="list-disc pl-5">
        <li><b>Blocs by party</b>: left = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; centrão (Brazil's transactional,
          office-seeking parties) = PP, Republicanos, União, MDB, PSD, Podemos, PRD, Solidariedade, Avante, Agir, Mobiliza; far right =
          PL, NOVO, MISSÃO, DC; others = PSDB, Cidadania, Democrata and the rest. The centrão follows the ABCP survey of 379 political
          scientists (
          <a className="text-accent" href="https://congressoemfoco.com.br/coluna/37360/afinal-que-partidos-integram-o-centrao-pesquisa-inedita-aponta" target="_blank" rel="noreferrer">Testa, Mesquita &amp; Bolognesi, Cadernos CRH, 2024</a>
          ), which also includes PL; here PL stays in the far right because of its Bolsonarist alignment (
          <a className="text-accent" href="https://scielo.br/j/dados/a/zzyM3gzHD4P45WWdytXjZWg/?format=pdf" target="_blank" rel="noreferrer">Bolognesi, Ribeiro &amp; Codato, Dados, 2023</a>
          ). PTB and Patriota became PRD; Solidariedade, Avante, Agir and Mobiliza join for the same profile. The classification can be
          changed on the page and is saved in the browser.</li>
        <li><b>Classification by candidacy</b>, over the party, for Bolsonarists outside PL. Two rules, in this order: (1) curation with a
          public source (declared support from the Bolsonaro family or former member of the Bolsonaro government; advocacy of amnesty for
          the January 8 defendants or attacks on the electoral process; a recurring Bolsonarist record in the press; a Bolsonarist motion
          or caucus in the state assembly); (2) those who were federal deputies and voted Yes on the amnesty urgency (
          <a className="text-accent" href="https://dadosabertos.camara.leg.br/api/v2/votacoes/2562149-7/votos" target="_blank" rel="noreferrer">Chamber of Deputies, Sep 17 2025, 311 to 163</a>
          ), matched to the TSE by civil name. When in doubt, the party prevails. The page's table shows each case with criterion,
          evidence and source; the switch can be turned off.</li>
        <li><b>Figures</b>: candidate + party votes by city, party and office (TSE); seats and runoffs from the TSE status; paid ads and
          themes only for elected candidacies (the only ones collected), with cost per 1,000 reached = Σ spend ÷ Σ reach × 1,000. Spend
          per vote does not measure effect: those who advertise more are usually already stronger.</li>
      </ul>
      <h2 className="display text-xl">Still hope (runoff)</h2>
      <ul className="list-disc pl-5">
        <li><b>Potential</b> of a territory = 10% of abstainers × (valid ÷ turnout) × (% Lula − % opponent), assuming new voters vote
          like those who already voted there. A yardstick for ranking priorities, not a forecast: abstention tends to be higher among
          poorer and younger voters, which usually favours Lula, but there is no individual-level data.</li>
        <li><b>Bands</b>: "mobilize" = Lula ahead by 10 pp or more, or ahead with abstention above the polling-place median;
          "contest" = within 10 pp; "contain" = opponent ahead by more than 10 pp (a turnout drive there helps the opponent).</li>
        <li><b>Neighbourhood</b> is that of the polling place (see above); only neighbourhoods with 500 or more voters are included.
          A candidacy's "strong base" = neighbourhoods where it polled 1.2× or more its state average with 100 or more votes. Priority
          per candidacy = potential × relative strength (capped at 3×). The Apocalypse cards use exactly this calculation.</li>
      </ul>
      <h2 className="display text-xl">Digital growth (MG)</h2>
      <ul className="list-disc pl-5">
        <li>16 State Deputy candidacies from the September monitoring, linked to the TSE data by ballot number, office and state.</li>
        <li>Followers observed on September 1, 4, 6, 13 and 20 (history) and in the current snapshot via Apify; only observed dates,
          with no invented daily curve; platforms kept separate; followers are neither voters nor votes.</li>
        <li>Instagram posts since August 16: likes and comments accumulated up to the collection; no engagement rate.</li>
      </ul>
      <h2 className="display text-xl">Sources</h2>
      <p className="text-sm text-muted">
        TSE (ballot-box reports, official results and polling place registry) · IBGE (municipal boundaries) ·
        Basemap: OpenFreeMap / © OpenStreetMap.
      </p>
    </article>
  );
}
