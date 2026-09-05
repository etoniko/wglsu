/** Каталог подарков: 1 бесплатный доступен, платные — пока тёмные / «скоро» */
export const GIFTS = [
  {
    id: "bear_hug",
    title: "Медвежий обнимашки",
    desc: "Тёплый привет от зоны .su",
    icon: "/assets/gifts/bear_hug.png",
    priceRub: 0,
    free: true,
    available: true,
  },
  {
    id: "gold_star",
    title: "Золотая звезда",
    desc: "Скоро за рубли",
    icon: "/assets/gifts/gold_star.png",
    priceRub: 49,
    free: false,
    available: false,
  },
  {
    id: "fire_pack",
    title: "Огненный пак",
    desc: "Скоро за рубли",
    icon: "/assets/gifts/fire_pack.png",
    priceRub: 99,
    free: false,
    available: false,
  },
  {
    id: "crown",
    title: "Корона лидера",
    desc: "Скоро за рубли",
    icon: "/assets/gifts/crown.png",
    priceRub: 199,
    free: false,
    available: false,
  },
  {
    id: "diamond",
    title: "Алмаз .su",
    desc: "Скоро за рубли",
    icon: "/assets/gifts/diamond.png",
    priceRub: 299,
    free: false,
    available: false,
  },
];

export function getGift(id) {
  return GIFTS.find((g) => g.id === id) || null;
}

export function giftsCatalog() {
  return GIFTS.map((g) => ({ ...g }));
}

/** У каждого игрока 1 бесплатный подарок (если поле не задано — считаем 1) */
export function freeGiftsLeft(user) {
  if (user.freeGiftsLeft === undefined || user.freeGiftsLeft === null) return 1;
  return Math.max(0, Number(user.freeGiftsLeft) || 0);
}
