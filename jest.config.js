module.exports = {
    maxWorkers: 1,
    roots: ["<rootDir>/source/ts"],
    transform: {"^.+.ts$": "ts-jest"},
    testEnvironment: "node",
    testRegex: "^.+/Test/.+Test\\.ts$",
    moduleFileExtensions: ["ts", "js", "json"]
};
