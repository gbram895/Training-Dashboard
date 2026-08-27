const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;

export function dropboxConfigured(): boolean {
  return Boolean(APP_KEY && APP_SECRET);
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  if (!APP_KEY) throw new Error('DROPBOX_APP_KEY is not set');
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    token_access_type: 'offline',
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  if (!APP_KEY || !APP_SECRET) throw new Error('Dropbox app credentials are not set');
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: APP_KEY,
      client_secret: APP_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dropbox token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (!APP_KEY || !APP_SECRET) throw new Error('Dropbox app credentials are not set');
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: APP_KEY,
      client_secret: APP_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dropbox token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

export interface DropboxFileEntry {
  '.tag': string;
  name: string;
  path_lower: string;
  server_modified: string;
}

interface ListFolderResponse {
  entries: DropboxFileEntry[];
  cursor: string;
  has_more: boolean;
}

export async function listFolder(accessToken: string, path: string): Promise<DropboxFileEntry[]> {
  const all: DropboxFileEntry[] = [];

  let res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!res.ok) {
    throw new Error(`Dropbox list_folder failed: ${res.status} ${await res.text()}`);
  }
  let data = (await res.json()) as ListFolderResponse;
  all.push(...data.entries);

  while (data.has_more) {
    res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cursor: data.cursor }),
    });
    if (!res.ok) {
      throw new Error(`Dropbox list_folder/continue failed: ${res.status} ${await res.text()}`);
    }
    data = (await res.json()) as ListFolderResponse;
    all.push(...data.entries);
  }

  return all.filter((e) => e['.tag'] === 'file');
}

export async function downloadFile(accessToken: string, path: string): Promise<string> {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (!res.ok) {
    throw new Error(`Dropbox download failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}
