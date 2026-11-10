'use strict';

const EARN_PROTOCOLS = Object.freeze({
  venus: Object.freeze({
    chainId: 56,
    underlying: '0x55d398326f99059fF775485246999027B3197955',
    market: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  }),
  aaveV3: Object.freeze({
    chainId: 56,
    underlying: '0x55d398326f99059fF775485246999027B3197955',
    pool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
    aToken: '0xa9251ca9DE909CB71783723713B21E4233fbf1B1',
  }),
});

module.exports = { EARN_PROTOCOLS };
