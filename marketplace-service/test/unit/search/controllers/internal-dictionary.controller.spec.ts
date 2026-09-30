import { BadRequestException, ConflictException } from '@nestjs/common';
import { InternalDictionaryController } from '../../../../src/modules/search/controllers/internal-dictionary.controller';

describe('InternalDictionaryController', () => {
  const repository = {
    createEntry: jest.fn(),
    addAlias: jest.fn(),
  };
  const controller = new InternalDictionaryController(repository as never);

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates the entry with the trimmed canonical value', async () => {
      repository.createEntry.mockResolvedValue({ id: 'dict-1' });

      const result = await controller.create({
        dictionaryType: 'MAKE',
        canonicalValue: '  BYD  ',
      });

      expect(repository.createEntry).toHaveBeenCalledWith('MAKE', 'BYD');
      expect(result).toEqual({ id: 'dict-1' });
    });

    it('turns a repository rejection into a 409, not a 500', async () => {
      repository.createEntry.mockRejectedValue(
        new Error('"Toyota" already exists'),
      );

      await expect(
        controller.create({ dictionaryType: 'MAKE', canonicalValue: 'Toyota' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('addAlias', () => {
    it('adds the trimmed alias to the given entry', async () => {
      repository.addAlias.mockResolvedValue(true);

      const result = await controller.addAlias('dict-toyota', {
        alias: '  Toyott  ',
      });

      expect(repository.addAlias).toHaveBeenCalledWith('dict-toyota', 'Toyott');
      expect(result).toEqual({ added: true });
    });

    it('400s when the alias was not added', async () => {
      repository.addAlias.mockResolvedValue(false);

      await expect(
        controller.addAlias('dict-toyota', { alias: 'Toyott' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
