import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
 
export async function POST(request: NextRequest) {
  const data = await request.json();
  fs.writeFile('data.json', JSON.stringify(data), (err) => {
    if (err) {
      console.error(err);
      return NextResponse.json({ message: 'Error saving data' }, { status: 500 })
    } else {
      return NextResponse.json({ message: 'Data saved successfully' }, { status: 200 })
    }
  });
  return NextResponse.json({ message: 'Data saved successfully' }, { status: 200 })
}