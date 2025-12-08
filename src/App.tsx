import { useEffect, useState } from "react";
import { openDB } from "idb";
import MiniSearch from "minisearch";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Folder, FileText, Search, X, GripVertical } from "lucide-react";

interface Document {
  id: string;
  name: string;
  thumbnail: string;
  addedAt: number;
}

interface Collection {
  id: string;
  name: string;
  documentIds: string[];
}

// In-memory state (will be loaded from IndexedDB)
let documents: Document[] = [];
let collections: Collection[] = [];
let searchIndex = new MiniSearch({
  fields: ["name"],
  storeFields: ["id", "name", "thumbnail"],
});

export default function App() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [colls, setColls] = useState<Collection[]>([]);
  const [selectedColl, setSelectedColl] = useState<Collection | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  // ─── Load from IndexedDB once ───
  useEffect(() => {
    (async () => {
      const db = await openDB("PaperplayDB", 1, {
        upgrade(db) {
          db.createObjectStore("documents", { keyPath: "id" });
          db.createObjectStore("collections", { keyPath: "id" });
        },
      });

      const savedDocs = (await db.getAll("documents")) as Document[];
      const savedColls = (await db.getAll("collections")) as Collection[];

      documents = savedDocs.length ? savedDocs : [];
      collections = savedColls.length
        ? savedColls
        : [{ id: "all", name: "All Documents", documentIds: documents.map(d => d.id) }];

      // Rebuild search index
      searchIndex = new MiniSearch({ fields: ["name"], storeFields: ["id", "name", "thumbnail"] });
      searchIndex.addAll(documents);

      setDocs(documents);
      setColls(collections);
      setSelectedColl(collections[0] || null);
    })();
  }, []);

  const createThumbnail = (file: File): Promise<string> => {
    return new Promise(resolve => {
      if (file.type === "application/pdf" || file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 280;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#f3f4f6";
          ctx.fillRect(0, 0, 200, 280);
          ctx.drawImage(img, 0, 0, 200, 280);
          resolve(canvas.toDataURL());
        };
        img.onerror = () => resolve("/fallback.png"); // fallback
        img.src = url;
      } else {
        resolve("data:image/svg+xml;base64,PHN2Zy..."); // simple icon placeholder
      }
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const db = await openDB("PaperplayDB", 1);
    const newDocs: Document[] = [];

    for (const file of files) {
      const thumbnail = await createThumbnail(file);
      const doc: Document = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        thumbnail,
        addedAt: Date.now(),
      };
      await db.put("documents", doc);
      newDocs.push(doc);
      searchIndex.add({ id: doc.id, name: doc.name, thumbnail });
    }

    documents = [...documents, ...newDocs];
    setDocs(documents);

    // Update "All Documents" collection
    const allColl = collections.find(c => c.id === "all");
    if (allColl) {
      allColl.documentIds = documents.map(d => d.id);
      await db.put("collections", allColl);
    }
  };

    // Accept native HTML5 drops onto a collection
  const handleCollectionDrop = async (e: React.DragEvent, targetCollId: string) => {
    e.preventDefault();
    const docId = e.dataTransfer.getData("text/plain");
    if (!docId) return;
  
    const target = collections.find(c => c.id === targetCollId);
    if (!target) return;
    if (target.documentIds.includes(docId)) return;
  
    const db = await openDB("PaperplayDB", 1);
    target.documentIds.push(docId);
    await db.put("collections", target);
  
    // update in-memory and state
    collections = collections.map(c => (c.id === target.id ? target : c));
    setColls([...collections]);
  };

  const createCollection = async () => {
    if (!newCollName.trim()) return;
    const coll: Collection = {
      id: crypto.randomUUID(),
      name: newCollName,
      documentIds: [],
    };
    const db = await openDB("PaperplayDB", 1);
    await db.put("collections", coll);
    collections = [...collections, coll];
    setColls(collections);
    setNewCollName("");
    setShowNewColl(false);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const docId = active.id as string;
    const targetCollId = over.id as string;

    const target = collections.find(c => c.id === targetCollId);
    if (!target || target.documentIds.includes(docId)) return;

    const db = await openDB("PaperplayDB", 1);
    target.documentIds.push(docId);
    await db.put("collections", target);
    setColls([...collections]);
  };

  const displayed = selectedColl
    ? selectedColl.id === "all"
      ? docs
      : docs.filter(d => selectedColl.documentIds.includes(d.id))
    : docs;

  const filtered = searchQuery
    ? searchIndex.search(searchQuery).map(r => docs.find(d => d.id === r.id)!).filter(Boolean)
    : displayed;

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg p-5 flex flex-col">
        <h1 className="text-2xl font-bold text-indigo-600 mb-8">Paperplay</h1>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex-1 space-y-2">
            {colls.map(coll => (
              <div
                key={coll.id}
                onClick={() => setSelectedColl(coll)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleCollectionDrop(e, coll.id)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                  selectedColl?.id === coll.id ? "bg-indigo-100 text-indigo-700" : "hover:bg-gray-100"
                }`}
              >
                <Folder className="w-5 h-5" />
                <span className="font-medium flex-1">{coll.name}</span>
                <span className="text-sm text-gray-500">
                  {coll.id === "all" ? docs.length : coll.documentIds.length}
                </span>
              </div>
            ))}
          </div>
        </DndContext>

        <button
          onClick={() => setShowNewColl(true)}
          className="mt-6 flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
        >
          <Plus className="w-5 h-5" /> New Collection
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold">{selectedColl?.name || "Documents"}</h2>
            <div className="flex gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-3 border rounded-lg w-80"
                />
              </div>
              <label className="bg-green-600 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-green-700">
                Upload
                <input type="file" multiple onChange={handleUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
            {filtered.map(doc => (
              <div
                key={doc.id}
                className="bg-white rounded-lg shadow hover:shadow-lg transition cursor-move"
                draggable
                onDragStart={e => e.dataTransfer.setData("text/plain", doc.id)}
              >
                <img src={doc.thumbnail} alt={doc.name} className="w-full h-56 object-cover rounded-t-lg" />
                <div className="p-3">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <div className="flex justify-between mt-2">
                    <GripVertical className="w-5 h-5 text-gray-400" />
                    <FileText className="w-4 h-4 text-gray-500" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New collection modal */}
      {showNewColl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <div className="flex justify-between mb-4">
              <h3 className="text-xl font-bold">New Collection</h3>
              <button onClick={() => setShowNewColl(false)}><X className="w-6 h-6" /></button>
            </div>
            <input
              autoFocus
              value={newCollName}
              onChange={e => setNewCollName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createCollection()}
              placeholder="Receipts 2025"
              className="w-full px-4 py-3 border rounded-lg mb-4"
            />
            <button
              onClick={createCollection}
              className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}