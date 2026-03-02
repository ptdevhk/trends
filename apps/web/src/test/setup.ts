import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

process.env.NODE_ENV = 'test'

expect.extend(matchers)
