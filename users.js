const ADJECTIVES = [
  'Swift', 'Bold', 'Calm', 'Dark', 'Epic', 'Fast', 'Grim', 'Hazy',
  'Icy', 'Jade', 'Keen', 'Loud', 'Mint', 'Neon', 'Pale', 'Quick',
  'Red', 'Sly', 'Tiny', 'Vast', 'Wild', 'Zany', 'Aqua', 'Blaze',
  'Crisp', 'Dusk', 'Ember', 'Frost', 'Gold', 'Hex', 'Iron', 'Jet',
  'Kiwi', 'Lime', 'Moss', 'Nova', 'Onyx', 'Pine', 'Quartz', 'Rust',
  'Storm', 'Tidal', 'Ultra', 'Vivid', 'Warm', 'Xenon', 'Yogi', 'Zen',
  'Brave', 'Coral', 'Delta', 'Fern', 'Gleam', 'Hyper'
];

const ANIMALS = [
  'Fox', 'Wolf', 'Bear', 'Hawk', 'Lynx', 'Puma', 'Crow', 'Deer',
  'Elk', 'Frog', 'Goat', 'Hare', 'Ibis', 'Jay', 'Koi', 'Lion',
  'Mole', 'Newt', 'Owl', 'Pike', 'Ram', 'Seal', 'Toad', 'Vole',
  'Wren', 'Yak', 'Ant', 'Bat', 'Cat', 'Dog', 'Eel', 'Fly',
  'Gnu', 'Hen', 'Imp', 'Kite', 'Lark', 'Moth', 'Oryx', 'Pug',
  'Quail', 'Ray', 'Swan', 'Tern', 'Urchin', 'Viper', 'Wasp', 'Zebra',
  'Cobra', 'Drake', 'Eagle', 'Finch', 'Gecko', 'Hippo'
];

class UserManager {
  constructor() {
    this.users = new Map();
    this.usedNames = new Set();
    this._hueCounter = 0;
  }

  _generateColor() {
    const hue = (this._hueCounter * 137.508) % 360;
    this._hueCounter++;
    return `hsl(${Math.round(hue)}, 72%, 58%)`;
  }

  _generateName() {
    for (let i = 0; i < 50; i++) {
      const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
      const name = `${adj} ${animal}`;
      if (!this.usedNames.has(name)) return name;
    }
    // fallback
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj} ${animal} ${Math.floor(Math.random() * 100)}`;
  }

  addUser(socketId) {
    const name = this._generateName();
    const color = this._generateColor();
    const user = { name, color };
    this.users.set(socketId, user);
    this.usedNames.add(name);
    return user;
  }

  removeUser(socketId) {
    const user = this.users.get(socketId);
    if (user) {
      this.users.delete(socketId);
    }
    return user;
  }

  getUser(socketId) {
    return this.users.get(socketId) || null;
  }

  getOnlineCount() {
    return this.users.size;
  }
}

module.exports = { UserManager };
