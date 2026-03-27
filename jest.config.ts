import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
  moduleNameMapper: { '@/(.*)': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/src/tests/setup.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/tests/**', '!src/server.ts'],
  testTimeout: 15000,
};

export default config;
