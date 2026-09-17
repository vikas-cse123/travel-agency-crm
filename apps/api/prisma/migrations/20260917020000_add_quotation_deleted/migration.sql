-- Add QUOTATION_DELETED to ActivityAction enum for permanent deletion auditing
ALTER TYPE "ActivityAction" ADD VALUE 'QUOTATION_DELETED';
