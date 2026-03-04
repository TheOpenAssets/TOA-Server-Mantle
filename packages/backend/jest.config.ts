import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^uuid$': '<rootDir>/../__mocks__/uuid.js',
    '^@openassets/types$': '<rootDir>/../../types/src/index.ts',
    '^@contracts/mantle$': '<rootDir>/../../contracts/index.ts',
    '^@contracts/arbitrum$': '<rootDir>/../../arbitrum-contracts/index.ts',
    '^@contracts/stellar$': '<rootDir>/../../stellar-contracts/index.ts',
  },
};

export default config;
