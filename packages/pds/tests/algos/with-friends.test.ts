import AtpAgent, { AtUri } from '@atproto/api'
import { runTestServer, TestServerInfo } from '../_util'
import { RecordRef, SeedClient } from '../seeds/client'
import userSeed from '../seeds/users'
import { makeAlgos } from '../../src'

describe('algo with friends', () => {
  let server: TestServerInfo
  let agent: AtpAgent
  let sc: SeedClient

  // account dids, for convenience
  let alice: string
  let bob: string
  let carol: string
  let dan: string

  const feedPublisherDid = 'did:example:feed-publisher'
  const feedUri = AtUri.make(
    feedPublisherDid,
    'app.bsky.feed.generator',
    'with-friends',
  ).toString()

  beforeAll(async () => {
    server = await runTestServer(
      {
        dbPostgresSchema: 'algo_with_friends',
      },
      {
        algos: makeAlgos(feedPublisherDid),
      },
    )
    agent = new AtpAgent({ service: server.url })
    sc = new SeedClient(agent)
    await userSeed(sc)

    alice = sc.dids.alice
    bob = sc.dids.bob
    carol = sc.dids.carol
    dan = sc.dids.dan

    await server.ctx.backgroundQueue.processAll()
  })

  afterAll(async () => {
    await server.close()
  })

  let expectedFeed: string[]

  it('setup', async () => {
    for (let i = 0; i < 10; i++) {
      const name = `user${i}`
      await sc.createAccount(name, {
        handle: `user${i}.test`,
        email: `user${i}@test.com`,
        password: 'password',
      })
    }

    const hitLikeThreshold = async (ref: RecordRef) => {
      for (let i = 0; i < 10; i++) {
        const name = `user${i}`
        await sc.like(sc.dids[name], ref)
      }
    }

    // bob and dan are mutuals of alice, all userN are out-of-network.
    await sc.follow(alice, bob)
    await sc.follow(alice, carol)
    await sc.follow(alice, dan)
    await sc.follow(bob, alice)
    await sc.follow(dan, alice)
    const one = await sc.post(bob, 'one')
    const two = await sc.post(bob, 'two')
    const three = await sc.post(carol, 'three')
    const four = await sc.post(carol, 'four')
    const five = await sc.post(dan, 'five')
    const six = await sc.post(dan, 'six')
    const seven = await sc.post(sc.dids.user0, 'seven')
    const eight = await sc.post(sc.dids.user0, 'eight')
    const nine = await sc.post(sc.dids.user1, 'nine')
    const ten = await sc.post(sc.dids.user1, 'ten')

    // 1, 2, 3, 4, 6, 8, 10 hit like threshold
    await hitLikeThreshold(one.ref)
    await hitLikeThreshold(two.ref)
    await hitLikeThreshold(three.ref)
    await hitLikeThreshold(four.ref)
    await hitLikeThreshold(six.ref)
    await hitLikeThreshold(eight.ref)
    await hitLikeThreshold(ten.ref)

    // 1, 4, 7, 8, 10 liked by mutual
    await sc.like(bob, one.ref)
    await sc.like(dan, four.ref)
    await sc.like(bob, seven.ref)
    await sc.like(dan, eight.ref)
    await sc.like(bob, nine.ref)
    await sc.like(dan, ten.ref)

    // all liked by non-mutual
    await sc.like(carol, one.ref)
    await sc.like(carol, two.ref)
    await sc.like(carol, three.ref)
    await sc.like(carol, four.ref)
    await sc.like(carol, five.ref)
    await sc.like(carol, six.ref)
    await sc.like(carol, seven.ref)
    await sc.like(carol, eight.ref)
    await sc.like(carol, nine.ref)
    await sc.like(carol, ten.ref)

    expectedFeed = [
      ten.ref.uriStr,
      eight.ref.uriStr,
      four.ref.uriStr,
      one.ref.uriStr,
    ]
  })

  it('returns popular in & out of network posts', async () => {
    const res = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri },
      { headers: sc.getHeaders(alice) },
    )
    const feedUris = res.data.feed.map((i) => i.post.uri)
    expect(feedUris).toEqual(expectedFeed)
  })

  it('paginates', async () => {
    const res = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri },
      { headers: sc.getHeaders(alice) },
    )
    const first = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri, limit: 2 },
      { headers: sc.getHeaders(alice) },
    )
    const second = await agent.api.app.bsky.feed.getFeed(
      { feed: feedUri, cursor: first.data.cursor },
      { headers: sc.getHeaders(alice) },
    )

    expect([...first.data.feed, ...second.data.feed]).toEqual(res.data.feed)
  })
})
