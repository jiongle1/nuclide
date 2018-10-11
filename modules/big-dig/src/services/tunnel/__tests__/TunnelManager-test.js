/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 * @format
 * @emails oncall+nuclide
 */
import type {Observable} from 'rxjs';

import {getAvailableServerPort} from 'nuclide-commons/serverPort';
import {Subject} from 'rxjs';
import {TunnelManager} from '../TunnelManager';
import net from 'net';

/**
 * Returns a client and server transports connected, which can be used to
 * simulate a BigDig connection.
 */
function createTransport() {
  const clientStream = new Subject();
  const serverStream = new Subject();
  return {
    client: {
      send(message: string) {
        serverStream.next(message);
      },
      onMessage(): Observable<string> {
        return clientStream;
      },
    },
    server: {
      send(message: string) {
        clientStream.next(message);
      },
      onMessage(): Observable<string> {
        return serverStream;
      },
    },
  };
}

/**
 * Returns a server listening in `port`, which echo back received messages
 */
function createEchoServer(port: number): Promise<net$Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(connection => {
      connection.on('end', () => {});
      connection.pipe(connection);
    });
    server.on('error', err => {
      throw err;
    });
    server.listen(String(port), () => {
      resolve(server);
    });
  });
}

/**
 * Sends a message `value` to the server in `port` and returns its response.
 */
function echo(port: number, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let hasReceivedEcho = false;
    const client = net.createConnection({port}, () => {
      client.write(value);
    });
    client.on('data', data => {
      hasReceivedEcho = true;
      resolve(data.toString());
      client.end();
    });
    client.on('error', err => {
      reject(err);
    });
    client.on('end', () => {
      if (!hasReceivedEcho) {
        reject(new Error('Connection closed before receive response'));
      }
    });
  });
}

test('creates a tunnel', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const server = await createEchoServer(remotePort);
  const tunnel = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });

  expect(await echo(localPort, 'message1')).toBe('message1');
  expect(await echo(localPort, 'message2')).toBe('message2');

  server.close();
  tunnel.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('creates a reverse tunnel', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const server = await createEchoServer(localPort);
  const tunnel = await clientTunnelManager.createReverseTunnel(
    localPort,
    remotePort,
  );

  expect(await echo(remotePort, 'message1')).toBe('message1');
  expect(await echo(remotePort, 'message2')).toBe('message2');

  server.close();
  tunnel.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('creates multiple tunnels', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort1 = await getAvailableServerPort();
  const remotePort1 = await getAvailableServerPort();
  const server1 = await createEchoServer(remotePort1);
  const tunnel1 = await clientTunnelManager.createTunnel({
    localPort: localPort1,
    remotePort: remotePort1,
    useIPv4: false,
  });
  expect(await echo(localPort1, 'message1')).toBe('message1');
  expect(await echo(localPort1, 'message2')).toBe('message2');

  const localPort2 = await getAvailableServerPort();
  const remotePort2 = await getAvailableServerPort();
  const server2 = await createEchoServer(remotePort2);
  const tunnel2 = await clientTunnelManager.createTunnel({
    localPort: localPort2,
    remotePort: remotePort2,
    useIPv4: false,
  });
  expect(await echo(localPort2, 'message3')).toBe('message3');
  expect(await echo(localPort2, 'message4')).toBe('message4');

  server1.close();
  tunnel1.close();
  server2.close();
  tunnel2.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('throws an error if tunnel manager is closed', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  clientTunnelManager.close();

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();
  const server = await createEchoServer(localPort);

  await expect(
    clientTunnelManager.createTunnel({localPort, remotePort, useIPv4: false}),
  ).rejects.toThrowErrorMatchingSnapshot();

  await expect(
    clientTunnelManager.createReverseTunnel(remotePort, localPort),
  ).rejects.toThrowErrorMatchingSnapshot();

  server.close();
  serverTunnelManager.close();
});

test('throws an error if either port is already bound', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const localServer = await createEchoServer(localPort);
  await expect(
    clientTunnelManager.createTunnel({localPort, remotePort, useIPv4: false}),
  ).rejects.toThrow('listen EADDRINUSE :::' + localPort);
  await new Promise((res, rej) => localServer.close(() => res()));

  // TODO: cvreateReverseTunnel should throw an instance of error
  const remoteServer = await createEchoServer(remotePort);
  await expect(
    clientTunnelManager.createReverseTunnel(localPort, remotePort),
  ).rejects.toEqual({
    code: 'EADDRINUSE',
    errno: 'EADDRINUSE',
    syscall: 'listen',
    address: '::',
    port: remotePort,
  });

  localServer.close();
  remoteServer.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('should return an the existing tunnel if it already exists', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const server = await createEchoServer(remotePort);
  const tunnel1 = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });
  const tunnel2 = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });

  expect(tunnel1).toEqual(tunnel2);

  server.close();
  tunnel1.close();
  tunnel2.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('should not close a tunnel until all references are removed', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const server = await createEchoServer(remotePort);
  const tunnel1 = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });
  const tunnel2 = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });

  expect(tunnel1).toEqual(tunnel2);
  expect(await echo(localPort, 'message1')).toBe('message1');
  tunnel1.close();
  expect(await echo(localPort, 'message2')).toBe('message2');
  tunnel2.close();
  await expect(echo(localPort, 'message3')).rejects.toThrow(
    new RegExp(`connect ECONNREFUSED .*:${localPort}`),
  );

  server.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});

test('should correctly close tunnels when the tunnel manager is closed', async () => {
  const tunnelTransport = createTransport();
  const serverTunnelManager = new TunnelManager(tunnelTransport.server);
  const clientTunnelManager = new TunnelManager(tunnelTransport.client);

  const localPort = await getAvailableServerPort();
  const remotePort = await getAvailableServerPort();

  const server = await createEchoServer(remotePort);
  const tunnel = await clientTunnelManager.createTunnel({
    localPort,
    remotePort,
    useIPv4: false,
  });

  clientTunnelManager.close();
  await expect(echo(localPort, 'message3')).rejects.toThrow(
    new RegExp(`connect ECONNREFUSED .*:${localPort}`),
  );

  server.close();
  tunnel.close();
  serverTunnelManager.close();
  clientTunnelManager.close();
});
