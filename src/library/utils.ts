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
  '#f783ac', // original pink
  '#83f7ac', // mint green
  '#ac83f7', // lavender
  '#f7ac83', // peach
  '#83acf7', // sky blue
  '#acf783', // lime green
  '#f783f7', // magenta
  '#83f7f7', // cyan
  '#f7f783', // yellow
  '#f78383' // coral red
];

export function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}
