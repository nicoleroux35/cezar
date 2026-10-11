#!/usr/bin/env node
/**
 * Script de test pour le serveur MCP cezar
 * 
 * Usage:
 *   node test-mcp.js list-tools
 *   node test-mcp.js call-tool cezar_list_tasks
 *   node test-mcp.js call-tool cezar_create_task '{"task":"Fix bug in login"}'
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, 'dist', 'index.js');

function sendJsonRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        CEZ_API_URL: process.env.CEZ_API_URL || 'http://127.0.0.1:4321',
        CEZ_PROJECT_ID: process.env.CEZ_PROJECT_ID || 'default',
      },
    });

    let output = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}`));
      } else {
        try {
          // Parse JSONRPC responses from output
          const lines = output.split('\n').filter(line => line.trim());
          const responses = lines.map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          }).filter(Boolean);
          resolve(responses);
        } catch (err) {
          reject(err);
        }
      }
    });

    // Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    };

    child.stdin.write(JSON.stringify(initRequest) + '\n');

    // Send actual request
    const request = {
      jsonrpc: '2.0',
      id: 2,
      method,
      params,
    };

    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

async function main() {
  const [,, command, arg1, arg2] = process.argv;

  try {
    if (command === 'list-tools') {
      const responses = await sendJsonRpc('tools/list');
      console.log(JSON.stringify(responses, null, 2));
    } else if (command === 'call-tool' && arg1) {
      const args = arg2 ? JSON.parse(arg2) : {};
      const responses = await sendJsonRpc('tools/call', {
        name: arg1,
        arguments: args,
      });
      console.log(JSON.stringify(responses, null, 2));
    } else if (command === 'list-resources') {
      const responses = await sendJsonRpc('resources/list');
      console.log(JSON.stringify(responses, null, 2));
    } else if (command === 'read-resource' && arg1) {
      const responses = await sendJsonRpc('resources/read', {
        uri: arg1,
      });
      console.log(JSON.stringify(responses, null, 2));
    } else {
      console.log('Usage:');
      console.log('  node test-mcp.js list-tools');
      console.log('  node test-mcp.js list-resources');
      console.log('  node test-mcp.js read-resource cezar://tasks');
      console.log('  node test-mcp.js call-tool cezar_list_tasks');
      console.log('  node test-mcp.js call-tool cezar_create_task \'{"task":"Fix bug"}\'');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
