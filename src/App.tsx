import { useEffect, useState } from "react";
import { openDB } from "idb";
import MiniSearch from "minisearch";
import {
  DndContext,
  closestCorners,  // Changed for better drop detection
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,  // Explicit import
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
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

export default function App() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedColl, setSelectedColl] = useState<Collection | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewColl, setShowNewColl] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [searchIndex, setSearchIndex] = useState<MiniSearch>(new MiniSearch({
    fields: ["name"],
    storeFields: ["id", "name", "thumbnail"],
  }));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  // Load everything from IndexedDB
  useEffect(() => {
    (async () => {
      try {
        const db = await openDB("PaperplayDB", 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains("documents")) {
              db.createObjectStore("documents", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains("collections")) {
              db.createObjectStore("collections", { keyPath: "id" });
            }
          },
        });

        const savedDocs: Document[] = await db.getAll("documents");
        const savedColls: Collection[] = await db.getAll("collections");

        const allColls = savedColls.length > 0
          ? savedColls
          : [{ id: "all", name: "All Documents", documentIds: savedDocs.map(d => d.id) }];

        // Rebuild search index
        const index = new MiniSearch({
          fields: ["name"],
          storeFields: ["id", "name", "thumbnail"],
        });
        index.addAll(savedDocs);
        setSearchIndex(index);

        setDocs(savedDocs);
        setCollections(allColls);
        setSelectedColl(allColls[0] || null);
      } catch (error) {
        console.error("DB load error:", error);
      }
    })();
  }, []);

  // Thumbnail generator (with fallback for PDFs/images)
  const createThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 280;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, 200, 280);
          ctx.drawImage(img, 0, 0, 200, 280);
          resolve(canvas.toDataURL());
          URL.revokeObjectURL(url);
        };
        img.onerror = () => resolve(createFallbackThumbnail("image"));
        img.src = url;
      } else if (file.type === "application/pdf") {
        resolve(createFallbackThumbnail("pdf"));
      } else {
        resolve(createFallbackThumbnail("file"));
      }
    });
  };

  const createFallbackThumbnail = (type: "image" | "pdf" | "file"): string => {
    const icons = {
      pdf: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjRkY0QTAwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjMDAwIj5QREY8L3RleHQ+PC9zdmc+",
      image: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjRkZGRkZGIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTk5Ij5JbWFnZTwvdGV4dD48L3N2Zz4=",
      file: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjREREOERFIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTk5Ij5GaWxlPC90ZXh0Pjwvc3ZnPg=="
    };
    return icons[type] || icons.file;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const db = await openDB("PaperplayDB", 1);
      const newDocs: Document[] = [];

      for (const file of files) {
        const thumbnail = await createThumbnail(file);
        const doc: Document = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^/.]+$/, ""),  // Remove extension
          thumbnail,
          addedAt: Date.now(),
        };
        await db.put("documents", doc);
        newDocs.push(doc);
        searchIndex.add({ id: doc.id, name: doc.name, thumbnail: doc.thumbnail });
      }

      const updatedDocs = [...docs, ...newDocs];
      setDocs(updatedDocs);

      // Update "All Documents" collection
      setCollections(prev => prev.map(c => 
        c.id === "all" ? { ...c, documentIds: updatedDocs.map(d => d.id) } : c
      ));
    } catch (error) {
      console.error("Upload error:", error);
    }
  };

  const createCollection = async () => {
    if (!newCollName.trim()) return;
    try {
      const newColl: Collection = {
        id: crypto.randomUUID(),
        name: newCollName,
        documentIds: [],
      };
      const db = await openDB("PaperplayDB", 1);
      await db.put("collections", newColl);
      setCollections(prev => [...prev, newColl]);
      setNewCollName("");
      setShowNewColl(false);
    } catch (error) {
      console.error("Create collection error:", error);
    }
  };

  // Drag & drop: document → collection
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const docId = active.id as string;
    const targetCollId = over.id as string;

    if (targetCollId === "all") return;  // Prevent dropping on "All"

    setCollections(prev => prev.map(coll => {
      if (coll.id === targetCollId && !coll.documentIds.includes(docId)) {
        const updatedColl = { ...coll, documentIds: [...coll.documentIds, docId] };
        // Save to DB
        openDB("PaperplayDB", 1).then(db => db.put("collections", updatedColl));
        return updatedColl;
      }
      return coll;
    }));
  };

  // Sortable document card component
  const SortableDoc = ({ doc }: { doc: Document }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: doc.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="bg-white rounded-lg shadow hover:shadow-xl transition-all cursor-move"
      >
        <img src={doc.thumbnail} alt={doc.name} className="w-full h-56 object-cover rounded-t-lg" />
        <div className="p-4">
          <p className="text-sm font-medium truncate">{doc.name}</p>
          <div className="flex justify-between items-center mt-3">
            <GripVertical className="w-5 h-5 text-gray-400" />
            <FileText className="w-4 h-4 text-gray-500" />
          </div>
        </div>
      </div>
    );
  };

  const displayedDocs = selectedColl
    ? selectedColl.id === "all"
      ? docs
      : docs.filter(d => selectedColl.documentIds.includes(d.id))
    : docs;

  const filteredDocs = searchQuery
    ? searchIndex.search(searchQuery).map((r: any) => docs.find(d => d.id === r.id)).filter(Boolean) as Document[]
    : displayedDocs;

  const documentIds = filteredDocs.map(d => d.id);  // For SortableContext

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex h-screen bg-gray-100">
        {/* Sidebar */}
        <div className="w-64 bg-white shadow-lg p-5 flex flex-col">
          <h1 className="text-2xl font-bold text-indigo-600 mb-8">Paperplay</h1>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {collections.map(coll => (
              <div
                key={coll.id}
                onClick={() => setSelectedColl(coll)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                  selectedColl?.id === coll.id ? "bg-indigo-100 text-indigo-700 font-medium" : "hover:bg-gray-100"
                }`}
              >
                <Folder className="w-5 h-5" />
                <span className="flex-1">{coll.name}</span>
                <span className="text-sm text-gray-500">
                  {coll.id === "all" ? docs.length : coll.documentIds.length}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowNewColl(true)}
            className="mt-6 flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
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
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-3 border rounded-lg w-80 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <label className="bg-green-600 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-green-700 transition">
                  Upload
                  <input type="file" multiple accept="image/*,application/pdf" onChange={handleUpload} className="hidden" />
                </label>
              </div>
            </div>

            <SortableContext items={documentIds} strategy={verticalListSortingStrategy}>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                {filteredDocs.map(doc => (
                  <SortableDoc key={doc.id} doc={doc} />
                ))}
              </div>
            </SortableContext>
          </div>
        </div>

        {/* New collection modal */}
        {showNewColl && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">New Collection</h3>
                <button onClick={() => setShowNewColl(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <input
                autoFocus
                value={newCollName}
                onChange={e => setNewCollName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createCollection()}
                placeholder="e.g. Tax 2025"
                className="w-full px-4 py-3 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={createCollection}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition"
              >
                Create Collection
              </button>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}