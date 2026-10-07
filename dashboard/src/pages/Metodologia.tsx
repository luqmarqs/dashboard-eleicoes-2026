export function Metodologia() {
  return (
    <article className="flex max-w-3xl flex-col gap-4 leading-relaxed">
      <div className="eyebrow">Metodologia</div>
      <h1 className="display text-3xl">De onde vêm estes números</h1>
      <h2 className="display text-xl">Votos</h2>
      <p>
        Os votos foram lidos diretamente dos <b>Boletins de Urna (BU)</b> de todas as seções eleitorais de São Paulo,
        publicados pelo TSE em resultados.tse.jus.br (1º turno, 4/10/2026). A soma das seções foi conferida com o
        resultado oficial do TSE por zona, município e estado: a diferença é zero para todas as candidaturas e legendas.
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
          outra candidatura. O gasto é de quem pagou.</li>
        <li><b>Temas dos criativos</b>: classificação por termos, sem IA, em três eixos (políticas públicas, função eleitoral, como fala),
          revisada sobre os 110 mil anúncios coletados. Unidade: criativo distinto (o mesmo texto chega a centenas de anúncios, um por
          cidade). Rodapés legais (CNPJ, federação) são removidos antes; termos casam no começo de palavra. A verba por tema é dividida
          entre os temas de política de cada anúncio.</li>
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
