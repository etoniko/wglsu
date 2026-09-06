/** Общий каталог игр: короткий 5-символьный код латиницей */
export const GAMES = [
  {
    code: "agars",
    id: "agar-su",
    name: "Agar.su",
    url: "https://agar.su/",
    zone: ".su",
    video: "./video/agarsu.mp4",
    img: "./photo/agar-su.jpg",
    blurb: "Классика агарио",
  },
  {
    code: "agrio",
    id: "agario-rf",
    name: "Агарио.рф",
    url: "https://агарио.рф/",
    zone: ".рф",
    video: "./video/agario-rf.mp4",
    img: "./photo/agario-rf.jpg",
    blurb: "Агарио на русском",
  },
  {
    code: "zonex",
    id: "zonex-su",
    name: "ZoneX.su",
    url: "https://zonex.su/",
    zone: ".su",
    video: "./video/zonex-su.mp4",
    img: "./photo/zonex-su.jpg",
    blurb: "Зона контроля",
  },
  {
    code: "clers",
    id: "cler-su",
    name: "Cler.su",
    url: "https://cler.su/",
    zone: ".su",
    video: "./video/cler-su.mp4",
    img: "./photo/cler-su.jpg",
    blurb: "Быстрый экшен",
  },
  {
    code: "slith",
    id: "slither-su",
    name: "Slither.su",
    url: "https://slither.su/",
    zone: ".su",
    video: "./video/slither-su.mp4",
    img: "./photo/slither-su.jpg",
    blurb: "Змейки онлайн",
  },
];

export function findGame(q) {
  if (!q) return null;
  const s = String(q).toLowerCase();
  return (
    GAMES.find((g) => g.code === s) ||
    GAMES.find((g) => g.id === s) ||
    GAMES.find((g) => g.name.toLowerCase() === s) ||
    GAMES.find((g) => g.url === q) ||
    null
  );
}

export function playPath(game) {
  return `/g/${game.code}`;
}

/** Совместимость: динамический каталог подключается в server через allGames/findAnyGame */
