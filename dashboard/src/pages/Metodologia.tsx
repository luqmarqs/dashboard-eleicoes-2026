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
      <h2 className="display text-xl">Fontes</h2>
      <p className="text-sm text-muted">
        TSE (Boletins de Urna, resultados oficiais e cadastro de locais de votação) · IBGE (malhas municipais) ·
        Fundo de mapa: OpenFreeMap / © OpenStreetMap.
      </p>
    </article>
  );
}
