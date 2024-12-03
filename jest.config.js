module.exports = {
  transformIgnorePatterns: [
    "node_modules/(?!(node-fetch)/)" // Transpile `node-fetch`
  ],
  transform: {
    "^.+\\.[tj]sx?$": "babel-jest", // Ensure Babel is used to transpile JavaScript
  },
};
