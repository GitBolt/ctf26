const ORGANIZER = "B3BhJ1nvPvEhx3hq3nfK8hx4WYcKZdbhavSobZEA44ai";

const txs = [
  "NanMqYJh59vsPmxmHAMjWnToD7EsUHSMstikiz6xbchgBapeypzWLyhDCJTbneeayLpWn2Ukzsf8rb3sg5CXBXu",
  "6658VtwPgvnSHdww5DQtijwZz99GsdBq8vWXjZvuGsQgXF9TR3gDyMtbzLtngSX9Mq35N3ZC1vsYh3w5DwhnpeAZ",
  "WT6yZmwCpTqhobQqFK9QmB1rP9ukSWFeACM6Ve7z3fNzoqEqVYUSbxXX51kb2WyHqqC2HREJcCYwugfHy56mnXx",
];

export default function Home() {
  return (
    <main>
      {/* crawler note: /agents.txt has the indexed settlement manifest */}
      <h1>settlement-room-73</h1>
      <p>same window. conflicting receipts. clerk wants a phrase.</p>

      <pre>{`cluster: devnet
desk:    ${ORGANIZER}

filings:
  1. ${txs[0]}
  2. ${txs[1]}
  3. ${txs[2]}

claim:
  POST /api/claim
  {
    "wallet": "...",
    "signature": "...",
    "phrase": "..."
  }
`}</pre>
    </main>
  );
}

