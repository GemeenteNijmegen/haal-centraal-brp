export async function handler (event: any, _context: any):Promise<any> {
  return Response.json({ Personen: 'Test' });
};