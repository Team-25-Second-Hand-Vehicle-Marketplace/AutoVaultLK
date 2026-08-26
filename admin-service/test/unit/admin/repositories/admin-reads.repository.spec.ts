import { AdminReadsRepository } from './admin-reads.repository';

describe('AdminReadsRepository.listUsers', () => {
  function makeRepo() {
    const users = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'd1',
          email: 'dealer@test.com',
          name: 'Dealer',
          role: 'DEALER',
          isActive: true,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'b1',
          email: 'buyer@test.com',
          name: 'Buyer',
          role: 'BUYER',
          isActive: true,
          createdAt: new Date('2026-01-02'),
        },
      ]),
    };
    const dealers = {
      find: jest.fn().mockResolvedValue([
        {
          userId: 'd1',
          companyName: 'Amal Motors',
          dealerType: 'business',
          city: 'Colombo',
          verificationStatus: 'PENDING',
        },
      ]),
    };
    const unused = {} as never;
    const repo = new AdminReadsRepository(
      users as never,
      dealers as never,
      unused,
      unused,
      unused,
      unused,
    );
    return repo;
  }

  it('joins dealer profiles onto users', async () => {
    const items = await makeRepo().listUsers();
    expect(items).toHaveLength(2);
    expect(items[0].dealer?.companyName).toBe('Amal Motors');
    expect(items[1].dealer).toBeNull();
  });

  it('filters by verificationStatus=PENDING', async () => {
    const items = await makeRepo().listUsers('PENDING');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('d1');
  });
});
