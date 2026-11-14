import { BadRequestException, ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  classifySqsFailure,
  PermanentSqsMessageError,
} from './sqs-transaction-consumer.js';

describe('classifySqsFailure', () => {
  it.each([
    new PermanentSqsMessageError('invalid envelope'),
    new SyntaxError('invalid JSON'),
    new BadRequestException('invalid wager'),
    new ConflictException('idempotency conflict'),
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('constraint violation'), { code: '23514' }),
    ),
  ])('classifies permanent message or database errors', (error) => {
    expect(classifySqsFailure(error)).toBe('permanent');
  });

  it.each([
    new Error('connection reset'),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    new QueryFailedError(
      'UPDATE',
      [],
      Object.assign(new Error('serialization failure'), { code: '40001' }),
    ),
  ])('classifies retryable infrastructure errors', (error) => {
    expect(classifySqsFailure(error)).toBe('transient');
  });
});
