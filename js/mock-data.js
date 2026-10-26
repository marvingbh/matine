/*
 * Browser preview only (no window.tizen): a small offline catalog used when there is no
 * TMDB token, when the page is opened with ?mock, or when a TMDB fetch fails (offline).
 * Titles and services are plausible for Brazil but NOT live data. Posters are drawn with
 * CSS gradients; backdrops are the abstract images in mock/ (made by tools/make_mock.py).
 * Provider ids follow TMDB/JustWatch so the provider-to-app mapping is exercised.
 */
(function () {
  'use strict';

  var NETFLIX = 8, PRIME = 119, DISNEY = 337, MAX = 1899, GLOBO = 307, APPLE = 350, PARAMOUNT = 531, MUBI = 11;

  var providerNames = {};
  providerNames[NETFLIX] = 'Netflix';
  providerNames[PRIME] = 'Amazon Prime Video';
  providerNames[DISNEY] = 'Disney Plus';
  providerNames[MAX] = 'Max';
  providerNames[GLOBO] = 'Globoplay';
  providerNames[APPLE] = 'Apple TV Plus';
  providerNames[PARAMOUNT] = 'Paramount Plus';
  providerNames[MUBI] = 'MUBI';

  var genreNames = {
    movie: { 28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário',
      18: 'Drama', 10751: 'Família', 14: 'Fantasia', 36: 'História', 27: 'Terror', 9648: 'Mistério',
      10749: 'Romance', 878: 'Ficção científica', 53: 'Thriller', 10752: 'Guerra' },
    tv: { 10759: 'Ação e Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário',
      18: 'Drama', 10751: 'Família', 9648: 'Mistério', 10765: 'Ficção científica e Fantasia',
      10768: 'Guerra e Política' }
  };

  // palette: index into the poster gradients in css (.poster--p0 … p7) and mock/bd-N.jpg.
  var titles = [
    { id: 95396, type: 'tv', title: 'Ruptura', year: 2022, genres: [18, 9648, 10765], rating: 8.4, votes: 2400, popularity: 310, seasons: 2, palette: 0, providers: [APPLE], imdbId: 'tt11280740',
      overview: 'Funcionários de uma empresa misteriosa passam por um procedimento que separa a memória do trabalho da vida pessoal. Até que um deles começa a desconfiar do que acontece no escritório.' },
    { id: 136315, type: 'tv', title: 'O Urso', year: 2022, genres: [35, 18], rating: 8.2, votes: 1500, popularity: 190, seasons: 3, palette: 3, providers: [DISNEY], imdbId: 'tt14452776',
      overview: 'Um chef premiado volta a Chicago para assumir a lanchonete da família depois de uma tragédia, e tenta transformar a cozinha caótica em um restaurante de verdade.' },
    { id: 93405, type: 'tv', title: 'Round 6', year: 2021, genres: [10759, 9648, 18], rating: 7.8, votes: 15000, popularity: 520, seasons: 3, palette: 4, providers: [NETFLIX], lang: 'ko', countries: ['KR'], imdbId: 'tt10919420',
      overview: 'Centenas de pessoas endividadas aceitam participar de jogos infantis por um prêmio milionário. As regras são simples; perder custa a vida.' },
    { id: 693134, type: 'movie', title: 'Duna: Parte Dois', year: 2024, genres: [878, 12], rating: 8.1, votes: 6800, popularity: 400, runtime: 166, palette: 5, providers: [MAX], imdbId: 'tt15239678',
      overview: 'Paul Atreides se une a Chani e aos Fremen em uma guerra de vingança contra quem destruiu sua família, enquanto tenta evitar um futuro terrível que só ele consegue prever.' },
    { id: 1000837, type: 'movie', title: 'Ainda Estou Aqui', year: 2024, genres: [18, 36], rating: 7.9, votes: 1300, popularity: 260, runtime: 136, palette: 2, providers: [GLOBO], imdbId: 'tt14961016',
      overview: 'Rio de Janeiro, 1971. Quando o marido é levado pela ditadura e não volta, Eunice Paiva precisa se reinventar e criar os cinco filhos enquanto busca a verdade.' },
    { id: 126308, type: 'tv', title: 'Xógum: A Gloriosa Saga do Japão', year: 2024, genres: [18, 10768], rating: 8.5, votes: 1100, popularity: 210, seasons: 1, palette: 6, providers: [DISNEY], imdbId: 'tt2788316',
      overview: 'Japão, 1600. Um navegador inglês naufraga na costa e se vê no meio da disputa de poder entre senhores feudais às vésperas de uma guerra civil.' },
    { id: 100088, type: 'tv', title: 'The Last of Us', year: 2023, genres: [18, 10765], rating: 8.6, votes: 5600, popularity: 330, seasons: 2, palette: 7, providers: [MAX], imdbId: 'tt3581920',
      overview: 'Vinte anos depois do colapso da civilização, um sobrevivente endurecido é contratado para levar uma adolescente através de um país devastado.' },
    { id: 94605, type: 'tv', title: 'Arcane', year: 2021, genres: [16, 10765, 10759], rating: 8.8, votes: 4900, popularity: 240, seasons: 2, palette: 1, providers: [NETFLIX], imdbId: 'tt11126994',
      overview: 'Duas irmãs crescem em lados opostos de uma cidade dividida entre a riqueza de Piltover e a miséria subterrânea de Zaun.' },
    { id: 76479, type: 'tv', title: 'The Boys', year: 2019, genres: [10765, 10759], rating: 8.5, votes: 11000, popularity: 380, seasons: 4, palette: 4, providers: [PRIME], imdbId: 'tt1190634',
      overview: 'Num mundo em que super-heróis são celebridades corrompidas por uma corporação, um grupo de justiceiros decide enfrentá-los.' },
    { id: 108978, type: 'tv', title: 'Reacher', year: 2022, genres: [10759, 80], rating: 8.1, votes: 1800, popularity: 280, seasons: 3, palette: 5, providers: [PRIME],
      overview: 'Um ex-policial militar chega a uma pequena cidade e é preso por um assassinato que não cometeu. Logo descobre uma conspiração bem maior.' },
    { id: 97546, type: 'tv', title: 'Ted Lasso', year: 2020, genres: [35, 18], rating: 8.4, votes: 1600, popularity: 120, seasons: 3, palette: 3, providers: [APPLE], imdbId: 'tt10986410',
      overview: 'Um treinador de futebol americano sem nenhuma experiência é contratado para comandar um time de futebol inglês, e conquista todos com otimismo.' },
    { id: 95480, type: 'tv', title: 'Slow Horses', year: 2022, genres: [18, 80], rating: 8.0, votes: 700, popularity: 110, seasons: 5, palette: 7, providers: [APPLE],
      overview: 'Agentes do MI5 que caíram em desgraça são mandados para um departamento esquecido, mas se metem em casos que ninguém mais quer resolver.' },
    { id: 1022789, type: 'movie', title: 'Divertida Mente 2', year: 2024, genres: [16, 10751, 35], rating: 7.6, votes: 5200, popularity: 300, runtime: 96, palette: 1, providers: [DISNEY], companies: [3],
      overview: 'Riley entra na adolescência e a sala de controle da sua mente recebe novas emoções, como a Ansiedade, que chegam para mudar tudo.' },
    { id: 872585, type: 'movie', title: 'Oppenheimer', year: 2023, genres: [18, 36], rating: 8.1, votes: 9500, popularity: 230, runtime: 180, palette: 4, providers: [PRIME], imdbId: 'tt15398776',
      overview: 'A história do físico J. Robert Oppenheimer e do projeto secreto que criou a bomba atômica, e o preço pessoal que ele pagou por isso.' },
    { id: 119051, type: 'tv', title: 'Wandinha', year: 2022, genres: [35, 80, 9648], rating: 8.4, votes: 9000, popularity: 350, seasons: 2, palette: 6, providers: [NETFLIX],
      overview: 'Wandinha Addams investiga uma série de assassinatos enquanto tenta sobreviver à vida social de um internato para jovens excêntricos.' },
    { id: 89293, type: 'tv', title: 'Sintonia', year: 2019, genres: [18, 80], rating: 7.9, votes: 300, popularity: 60, seasons: 5, palette: 2, providers: [NETFLIX],
      overview: 'Três amigos que cresceram juntos numa favela de São Paulo seguem caminhos diferentes: o funk, a igreja e o crime.' },
    { id: 247718, type: 'tv', title: 'Cidade de Deus: A Luta Não Para', year: 2024, genres: [18, 80], rating: 7.6, votes: 200, popularity: 70, seasons: 1, palette: 5, providers: [MAX],
      overview: 'Duas décadas depois, Buscapé volta à Cidade de Deus, onde uma nova geração vive a mesma guerra entre o tráfico, a milícia e o Estado.' },
    { id: 222247, type: 'tv', title: 'Senna', year: 2024, genres: [18], rating: 7.7, votes: 500, popularity: 90, seasons: 1, palette: 3, providers: [NETFLIX],
      overview: 'A trajetória de Ayrton Senna, dos kartódromos de São Paulo aos três títulos mundiais de Fórmula 1.' },
    { id: 104876, type: 'tv', title: 'Bom Dia, Verônica', year: 2020, genres: [80, 18, 9648], rating: 7.7, votes: 400, popularity: 55, seasons: 3, palette: 0, providers: [NETFLIX],
      overview: 'Uma escrivã da polícia de São Paulo decide investigar por conta própria dois casos de violência contra mulheres que ninguém quer ver.' },
    { id: 157336, type: 'movie', title: 'Interestelar', year: 2014, genres: [12, 18, 878], rating: 8.4, votes: 36000, popularity: 200, runtime: 169, palette: 7, providers: [PARAMOUNT], imdbId: 'tt0816692',
      overview: 'Com a Terra à beira do colapso, um grupo de astronautas atravessa um buraco de minhoca em busca de um novo lar para a humanidade.' },
    { id: 496243, type: 'movie', title: 'Parasita', year: 2019, genres: [35, 53, 18], rating: 8.5, votes: 18000, popularity: 120, runtime: 133, palette: 2, providers: [MAX], lang: 'ko', imdbId: 'tt6751668',
      overview: 'Uma família pobre se infiltra, um por um, na casa de uma família rica, até que um segredo escondido no porão muda tudo.' },
    { id: 361743, type: 'movie', title: 'Top Gun: Maverick', year: 2022, genres: [28, 18], rating: 8.2, votes: 9000, popularity: 150, runtime: 131, palette: 5, providers: [PARAMOUNT],
      overview: 'Depois de trinta anos como piloto, Maverick volta à escola Top Gun para treinar jovens aviadores para uma missão quase impossível.' },
    { id: 1022690, type: 'movie', title: 'O Auto da Compadecida 2', year: 2024, genres: [35], rating: 7.0, votes: 300, popularity: 110, runtime: 105, palette: 3, providers: [PRIME, GLOBO],
      overview: 'João Grilo e Chicó estão de volta a Taperoá, agora no meio de uma eleição, com novas trapaças e a mesma fé na Compadecida.' },
    { id: 236994, type: 'tv', title: 'Pssica', year: 2025, genres: [80, 18], rating: 7.5, votes: 150, popularity: 140, seasons: 1, palette: 6, providers: [NETFLIX],
      overview: 'Nos rios da Amazônia paraense, uma jovem sequestrada, um contrabandista em fuga e uma mãe em busca de vingança têm os destinos cruzados.' },
    { id: 94997, type: 'tv', title: 'A Casa do Dragão', year: 2022, genres: [10765, 18, 10759], rating: 8.4, votes: 4600, popularity: 260, seasons: 2, palette: 4, providers: [MAX],
      overview: 'Duzentos anos antes de Game of Thrones, uma disputa pela sucessão ao Trono de Ferro divide a casa Targaryen e leva a uma guerra entre dragões.' },
    { id: 84773, type: 'tv', title: 'Os Anéis de Poder', year: 2022, genres: [10759, 10765, 18], rating: 7.3, votes: 3000, popularity: 170, seasons: 2, palette: 6, providers: [PRIME],
      overview: 'Na Segunda Era da Terra-média, elfos, anões e homens enfrentam o ressurgimento do mal que levará à forja dos anéis.' },
    { id: 545611, type: 'movie', title: 'Tudo em Todo o Lugar ao Mesmo Tempo', year: 2022, genres: [28, 12, 878], rating: 7.8, votes: 6500, popularity: 80, runtime: 139, palette: 1, providers: [PRIME],
      overview: 'A dona de uma lavanderia descobre que precisa se conectar com versões de si mesma em universos paralelos para salvar o mundo.' },
    { id: 792307, type: 'movie', title: 'Pobres Criaturas', year: 2023, genres: [878, 10749, 35], rating: 7.7, votes: 4500, popularity: 90, runtime: 141, palette: 0, providers: [DISNEY],
      overview: 'Trazida de volta à vida por um cientista excêntrico, Bella Baxter foge com um advogado para descobrir o mundo com olhos totalmente novos.' },
    { id: 67027, type: 'tv', title: 'Justiça', year: 2016, genres: [18, 80], rating: 8.0, votes: 120, popularity: 40, seasons: 2, palette: 2, providers: [GLOBO],
      overview: 'Quatro histórias se cruzam em Recife quando pessoas presas no mesmo dia saem da prisão sete anos depois, cada uma com contas a acertar.' },
    { id: 1184918, type: 'movie', title: 'Robô Selvagem', year: 2024, genres: [16, 878, 10751], rating: 8.3, votes: 4800, popularity: 210, runtime: 102, palette: 3, providers: [PRIME],
      overview: 'Uma robô naufraga numa ilha deserta, aprende a sobreviver entre os animais e acaba adotando um filhote de ganso órfão.' },
    { id: 915935, type: 'movie', title: 'Anatomia de uma Queda', year: 2023, genres: [18, 9648, 53], rating: 7.7, votes: 2400, popularity: 60, runtime: 151, palette: 7, providers: [PRIME],
      overview: 'Uma escritora é acusada da morte do marido, e o único que pode ajudar a esclarecer o que aconteceu é o filho do casal, que é cego.' },
    { id: 976893, type: 'movie', title: 'Dias Perfeitos', year: 2023, genres: [18], rating: 7.8, votes: 900, popularity: 35, runtime: 124, palette: 5, providers: [MUBI], lang: 'ja',
      overview: 'Hirayama limpa banheiros públicos em Tóquio e encontra beleza na rotina, nas árvores e nas fitas cassete que ouve no carro.' },
    { id: 264218, type: 'tv', title: 'Vale Tudo', year: 2025, genres: [18], rating: 6.8, votes: 90, popularity: 150, seasons: 1, palette: 0, providers: [GLOBO],
      overview: 'Raquel, uma mulher honesta, enfrenta a própria filha, que fará de tudo para subir na vida, numa nova versão da novela clássica.' },
    { id: 112470, type: 'tv', title: 'Ripley', year: 2024, genres: [18, 80], rating: 8.1, votes: 600, popularity: 50, seasons: 1, palette: 1, providers: [NETFLIX],
      overview: 'Nova York, anos 60. Um vigarista é contratado para trazer de volta da Itália o filho de um milionário, e se apaixona pela vida que encontra lá.' },
    { id: 1064213, type: 'movie', title: 'Anora', year: 2024, genres: [35, 18, 10749], rating: 7.1, votes: 2100, popularity: 100, runtime: 139, palette: 6, providers: [PRIME],
      overview: 'Uma jovem do Brooklyn se casa por impulso com o filho de um oligarca russo, e os pais dele vêm a Nova York para desfazer o casamento.' },
    { id: 1241982, type: 'movie', title: 'Moana 2', year: 2024, genres: [16, 12, 10751], rating: 7.0, votes: 1800, popularity: 160, runtime: 100, palette: 3, providers: [DISNEY], companies: [6125, 2],
      overview: 'Moana recebe um chamado dos ancestrais e parte com uma nova tripulação para os mares distantes da Oceania.' }
  ];

  // Japanese animation, to see the anime filter at work (hidden everywhere with hideAnime).
  titles.push({ id: 209867, type: 'tv', title: 'Frieren e a Jornada para o Além', year: 2023, genres: [16, 10759, 10765], rating: 8.8, votes: 600, popularity: 90, seasons: 1, palette: 1, providers: [NETFLIX], lang: 'ja', countries: ['JP'],
    overview: 'Depois de derrotar o Rei Demônio, uma maga elfa revisita os lugares da jornada e descobre o que a amizade com os companheiros significou.' });

  // Korean (and Round 6, Parasita, Dias Perfeitos above are Korean / Japanese): left out
  // everywhere by hideLanguages / hideCountries, although popular on the TV's apps.
  titles.push({ id: 94796, type: 'tv', title: 'Pousando no Amor', year: 2019, genres: [35, 18], rating: 8.7, votes: 1900, popularity: 600, seasons: 1, palette: 6, providers: [NETFLIX], lang: 'ko', countries: ['KR'],
    overview: 'Uma herdeira sul-coreana cai de parapente na Coreia do Norte e é escondida por um oficial do exército que se apaixona por ela.' });

  // Not on any streaming service in Brazil: "Só streaming" leaves it out of the search.
  titles.push({ id: 515195, type: 'movie', title: 'Bacurau', year: 2019, genres: [18, 53, 878], rating: 7.2, votes: 900, popularity: 30, runtime: 131, palette: 4, providers: [],
    overview: 'Pouco depois da morte da matriarca, os moradores de um povoado do sertão percebem que a comunidade sumiu do mapa e que estranhos estão por perto.' });

  // People for the search screen ("Pessoas"); credits are keys of the titles above.
  var people = [
    { id: 1, name: 'Fernanda Torres', dept: 'Acting', palette: 2, credits: ['movie:1000837'] },
    { id: 2, name: 'Pedro Pascal', dept: 'Acting', palette: 7, credits: ['tv:100088'] },
    { id: 3, name: 'Timothée Chalamet', dept: 'Acting', palette: 5, credits: ['movie:693134'] },
    { id: 4, name: 'Denis Villeneuve', dept: 'Directing', palette: 4, credits: ['movie:693134'] },
    { id: 5, name: 'Christopher Nolan', dept: 'Directing', palette: 7, credits: ['movie:872585', 'movie:157336'] },
    { id: 6, name: 'Selton Mello', dept: 'Acting', palette: 3, credits: ['movie:1022690', 'movie:1000837'] },
    { id: 7, name: 'Adam Scott', dept: 'Acting', palette: 0, credits: ['tv:95396'] }
  ];

  // Animation: only Divertida Mente 2 (Pixar) and Moana 2 (Disney) have the companies of
  // animationAllowCompanies; Arcane and Robô Selvagem are left out everywhere.

  var imdb = {
    tt11280740: '8.7', tt14452776: '8.5', tt10919420: '8.0', tt15239678: '8.5', tt14961016: '8.1',
    tt2788316: '8.6', tt3581920: '8.6', tt11126994: '9.0', tt1190634: '8.6', tt10986410: '8.8',
    tt15398776: '8.3', tt0816692: '8.7', tt6751668: '8.5'
  };

  var byKey = {};
  titles.forEach(function (t) { byKey[t.type + ':' + t.id] = t; });

  window.TVHOME_MOCK = {
    titles: titles,
    byKey: byKey,
    providerNames: providerNames,
    genreNames: genreNames,
    people: people,
    imdb: imdb
  };
})();
