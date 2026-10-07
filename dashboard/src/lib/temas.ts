/**
 * Temas dos criativos por regra (sem modelo de linguagem), revisão 2026.10.
 *
 * Origem: config/taxonomy.yml (v2026.09.1) do monitoramento MG, revisada com os 105 mil anúncios coletados das eleitas:
 * - rodapés legais ("Propaganda eleitoral – CNPJ … – FE BRASIL (PT/PCdoB/PV)") são removidos antes de classificar
 *   (faziam "fé" e "federação" dispararem);
 * - termos casam só no começo de palavra ("upa" não casa com "ocupa");
 * - saíram termos ambíguos ("caminhada", quase sempre figurada; "junto com"); entraram temas frequentes no resíduo
 *   (base regional / recursos para cidades; família e valores; mais ataque/contraste);
 * - unidade principal: CRIATIVO DISTINTO (página + texto) — o mesmo texto chega a 750 anúncios (um por cidade/variação),
 *   e contar anúncios mede segmentação, não mensagem;
 * - verba por tema: o gasto de cada anúncio (faixa) é DIVIDIDO entre seus temas de política pública, como pede a
 *   taxonomia original (marcar presença premia textos longos).
 */
import type { MetaAnuncio } from "./source";

export interface Tema { id: string; rotulo: string; termos: string[] }
export interface Eixo { id: string; rotulo: string; temas: Tema[] }

export const EIXOS: Eixo[] = [
  { id: "politica_publica", rotulo: "Políticas públicas", temas: [
    { id: "saude", rotulo: "Saúde / SUS", termos: ["saude", "sus ", "hospital", "medic", "upa ", "upas ", "enfermag", "hemodial", "vacina", "remedio", "samu ", "psiquiatr", "cirurgia", "posto de saude"] },
    { id: "educacao", rotulo: "Educação", termos: ["educacao", "escola", "professor", "universidade", "estudante", "creche", "merenda", "alfabetiz", "ensino", "bolsa de estudo"] },
    { id: "seguranca", rotulo: "Segurança", termos: ["seguranca publica", "policia", "policiais", "crime", "criminos", "armas", "violencia urbana", "penitenci", "bandido", "viatura", "guarda municipal"] },
    { id: "trabalho", rotulo: "Trabalho / servidor", termos: ["servidor", "concurso", "trabalhador", "salario", "isonomia", "sindicat", "6x1", "guarda civil", "emprego", "aposentad", "piso ", "carreira", "terceiriza", "clt "] },
    { id: "mobilidade", rotulo: "Mobilidade / transporte", termos: ["transporte", "onibus", "metro ", "tarifa", "mobilidade", "busao", "ar-condicionado", "ar condicionado", "transito", "catraca", "pedagio", "estrada", "rodovia", "pavimenta", "asfalto"] },
    { id: "mulheres", rotulo: "Mulheres / feminicídio", termos: ["feminicid", "mulher", "materna", "maria da penha", "aborto", "violencia domestica", "violencia contra a mulher"] },
    { id: "direitos_minorias", rotulo: "Direitos e minorias", termos: ["negra", "negro", "lgbt", "trans ", "travesti", "quilombo", "indigena", "racis", "deficien", "pcd ", "periferi", "favela", "autist", "tea ", "idoso"] },
    { id: "meio_ambiente", rotulo: "Meio ambiente / clima", termos: ["meio ambiente", "clima", "climatic", "mineracao", "barragem", "rejeito", "arboriza", "ambiental", "agrotoxic", "desmatamento", "saneamento", "agroecolog"] },
    { id: "enchentes", rotulo: "Enchentes / reconstrução", termos: ["enchente", "cheia ", "reconstrucao", "reconstruir", "atingidos", "desabrigad", "defesa civil", "diques"] },
    { id: "fome_assistencia", rotulo: "Fome / assistência social", termos: ["fome", "bolsa familia", "cesta basica", "assistencia social", "cozinha solidaria", "restaurante popular", "seguranca alimentar", "pobreza", "cras "] },
    { id: "habitacao", rotulo: "Habitação", termos: ["moradia", "habitacao", "aluguel", "despejo", "sem-teto", "sem teto", "regularizacao fundiaria", "minha casa"] },
    { id: "campo", rotulo: "Campo / agricultura", termos: ["agricultura", "agricultor", "produtor rural", "produtores rurais", "reforma agraria", "assentamento", "pequeno produtor", "cooperativa", "agronegocio", "agro "] },
    { id: "economia", rotulo: "Economia / pequeno negócio", termos: ["empreendedor", "pequeno negocio", "mei ", "imposto", "microempres", "feirante", "ambulante", "comercio", "industria"] },
    { id: "cultura_esporte", rotulo: "Cultura e esporte", termos: ["cultura", "artista", "carnaval", "musica", "funk", "terreiro", "esporte", "teatro", "audiovisual", "biblioteca", "futebol"] },
    { id: "juventude", rotulo: "Juventude", termos: ["juventude", "jovens", "primeiro emprego", "estagio", "passe livre"] },
    { id: "animais", rotulo: "Animais", termos: ["protecao animal", "causa animal", "castrac", "maus-tratos", "maus tratos", "animais", "pets "] },
    { id: "familia_valores", rotulo: "Família e valores", termos: ["defesa da familia", "familias brasileiras", "patria", "conservador", "valores cristaos", "ideologia de genero", "pro-vida", "defesa da vida", "liberdade de expressao"] },
    { id: "governo_estado", rotulo: "Governo do estado", termos: ["zema", "tarcisio", "eduardo leite", "governo do estado", "privatiza", "copasa", "cemig", "sabesp", "corsan", "desmonte", "sucateamento", "governo estadual"] },
    { id: "nacional", rotulo: "Lula / disputa nacional", termos: ["lula", "extrema-direita", "extrema direita", "bolsonaro", "tarifaco", "anistia"] },
  ] },
  { id: "funcao_eleitoral", rotulo: "Função eleitoral", temas: [
    { id: "pedido_de_voto", rotulo: "Pedido de voto / número", termos: ["meu numero e", "sou candidat", "candidata a deputada", "candidato a deputado", "vote ", "seu voto", "vote em", "urna", "e so digitar", "digite ", "4 de outubro", "04 de outubro", "conto com seu voto", "conto com voce"] },
    { id: "endosso", rotulo: "Apoios / dobrada", termos: ["apoio de", "apoio do ", "apoio da ", "indicado por", "ao lado de", "dobrada", "dobradinha", "vote tambem", "receber o apoio", "recebo o apoio", "nosso apoio a"] },
    { id: "evento", rotulo: "Evento / agenda", termos: ["lancamento", "comicio", "agenda", "panfletag", "encontro com", "carreata", "plenaria", "estarei em"] },
  ] },
  { id: "conteudo_relacional", rotulo: "Como fala", temas: [
    { id: "base_regional", rotulo: "Base regional / recursos para cidades", termos: ["nossa regiao", "toda regiao", "toda a regiao", "para a regiao", "recursos para", "levar recursos", "trazer recursos", "prefeito", "prefeitura", "vereador", "municipio", "nossa cidade", "investimentos para"] },
    { id: "balanco_mandato", rotulo: "Balanço de mandato", termos: ["ja entreguei", "meu mandato", "nosso mandato", "ja fiz", "minhas entregas", "emenda", "destinei", "destinamos", "conquistamos", "projeto de lei", "aprovamos", "lei de minha autoria"] },
    { id: "biografia", rotulo: "Biografia / trajetória", termos: ["de onde vim", "minha historia", "minha trajetoria", "cresci ", "a vida me levou", "minha mae", "minha familia", "nasci "] },
    { id: "fe", rotulo: "Fé / religião", termos: ["deus", "paz do senhor", "biblia", "oracao", "igreja", "evangel", "cristo", "com fe ", "a fe ", "de fe ", "fe em deus"] },
    { id: "mobilizacao", rotulo: "Mobilização / militância", termos: ["material de campanha", "receba meu material", "receba o material", "adesivo", "bandeira", "faca parte", "fazer parte", "doacao", "voluntari", "mutirao", "panfleto", "militancia"] },
    { id: "chamada_engajamento", rotulo: "Chamada de engajamento", termos: ["segue a gente", "me segue", "marque ", "comenta", "compartilha", "acompanhe", "curte ", "conta pra gente", "manda pra"] },
    { id: "ataque_contraste", rotulo: "Ataque / contraste", termos: ["big tech", "querem nos silenciar", "censura", "mentira", "fake news", "golpista", "bolsonarista", "petista", "impedir a direita", "contra a direita", "comunis", "corrupt", "ladrao", "ladroes"] },
  ] },
];

const ESC = /[.*+?^${}()|[\]\\]/g;
// Termo casa no começo de palavra; espaço no fim do termo exige palavra inteira ("piso " ≠ "pisoteio").

// Rodapés legais (identificação de quem paga, federação, coligação) não são mensagem: saem antes da classificação.
const RODAPES = [
  /propaganda eleitoral[^.!?\n]*/g, /cnpj[^.!?\n]*/g, /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}[^.!?\n]*/g,
  /federacao [^.!?\n]*/g, /\bfe (?:brasil|psol)[^.!?\n]*/g, /coligacao [^.!?\n]*/g, /pago por [^.!?\n]*/g,
];

/** Texto normalizado e sem rodapé legal: sem acento, minúsculo, sem @ e sem keycap de emoji. */
export function normalizarTexto(a: MetaAnuncio): string {
  let t = [...(a.textos ?? []), ...(a.titulos ?? [])].join(" \n ");
  t = t.normalize("NFKD").replace(/[̀-ͯ️⃣]/g, "").toLowerCase().replace(/@/g, "");
  for (const r of RODAPES) t = t.replace(r, " ");
  return ` ${t.replace(/\s+/g, " ")} `;
}

// Uma expressão por tema (alternação dos termos): ~30 testes por texto em vez de ~300.
const RE_TEMA: [string, RegExp][] = EIXOS.flatMap((e) => e.temas.map((tm): [string, RegExp] => [tm.id, new RegExp(
  `(?:^|[^a-z0-9])(?:${tm.termos.map((x) => x.trim().replace(ESC, "\\$&") + (x.endsWith(" ") ? "(?![a-z0-9])" : "")).join("|")})`)]));
const MEMO = new Map<string, Set<string>>();

/** Temas de um texto já normalizado (memorizado: o mesmo texto se repete em centenas de anúncios). */
export function temasDoTexto(t: string): Set<string> {
  let out = MEMO.get(t);
  if (!out) {
    out = new Set<string>();
    for (const [id, re] of RE_TEMA) if (re.test(t)) out.add(id);
    if (MEMO.size > 50_000) MEMO.clear();
    MEMO.set(t, out);
  }
  return out;
}

const POLITICA = new Set(EIXOS[0].temas.map((t) => t.id));

export interface ResumoTema {
  criativos: number;
  anuncios: number;
  /** verba dividida entre os temas de política pública do anúncio; max nulo = sem teto */
  verbaMin: number;
  verbaMax: number | null;
  /** criativo de maior gasto declarado (máx. da faixa) com o tema */
  exemplo: MetaAnuncio | null;
}

export interface ContagemTemas {
  anuncios: number;
  criativos: number;
  semTexto: number;
  semPolitica: number;
  porTema: Map<string, ResumoTema>;
  temasPorAnuncio: Map<string, Set<string>>;
}

/** Conta temas por criativo distinto (página + texto normalizado) e divide a verba BRL entre os temas de política. */
export function contarTemas(ads: MetaAnuncio[]): ContagemTemas {
  const porTema = new Map<string, ResumoTema>();
  const temasPorAnuncio = new Map<string, Set<string>>();
  const criativos = new Map<string, Set<string>>();
  let semTexto = 0;
  const cache = new Map<string, Set<string>>();
  for (const a of ads) {
    const t = normalizarTexto(a);
    if (t.trim().length < 3) { semTexto++; continue; }
    const chave = `${a.page_id}|${t}`;
    let temas = cache.get(chave);
    if (!temas) { temas = temasDoTexto(t); cache.set(chave, temas); criativos.set(chave, temas); }
    temasPorAnuncio.set(a.id, temas);
    const pol = [...temas].filter((x) => POLITICA.has(x));
    for (const id of temas) {
      const r = porTema.get(id) ?? { criativos: 0, anuncios: 0, verbaMin: 0, verbaMax: 0, exemplo: null };
      r.anuncios++;
      if (POLITICA.has(id) && a.moeda === "BRL") {
        const [lo, hi] = a.gasto;
        r.verbaMin += (lo ?? 0) / pol.length;
        r.verbaMax = r.verbaMax == null || hi == null ? null : r.verbaMax + hi / pol.length;
      }
      if (!r.exemplo || (a.gasto[1] ?? a.gasto[0] ?? 0) > (r.exemplo.gasto[1] ?? r.exemplo.gasto[0] ?? 0)) r.exemplo = a;
      porTema.set(id, r);
    }
  }
  for (const temas of criativos.values()) for (const id of temas) porTema.get(id)!.criativos++;
  const semPolitica = [...criativos.values()].filter((s) => ![...s].some((x) => POLITICA.has(x))).length;
  return { anuncios: ads.length, criativos: criativos.size, semTexto, semPolitica, porTema, temasPorAnuncio };
}
