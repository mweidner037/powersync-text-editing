const ADJECTIVES = ['Happy', 'Sad', 'Neutral', 'Large', 'Small', 'Average'];
const ANIMALS = ['Cat', 'Dog', 'Hamster', 'Chicken', 'Rabbit'];

export function randomName() {
  return (
    ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] +
    ' ' +
    ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  );
}

const COLORS = [
  '#F8F8FF', // Ghost White
  '#F0F8FF', // Alice Blue
  '#E6E6FA', // Lavender
  '#FFF0F5', // Lavender Blush
  '#F0FFFF', // Azure
  '#F5FFFA', // Mint Cream
  '#FFFACD', // Lemon Chiffon
  '#FFF8DC', // Cornsilk
  '#FFEFD5', // Papaya Whip
  '#FFE4E1', // Misty Rose
  '#E0FFFF', // Light Cyan
  '#F0F0F0', // Light Gray
  '#FAFAFA', // Very Light Gray
  '#FFE4B5', // Moccasin
  '#FFDAB9' // Peach Puff
];

export function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}
