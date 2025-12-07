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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Folder, FileText, Search, X, GripVertical } from "lucide-react";

// Types
interface Document {
  id: string;
  name: string;
  file: File;
  thumbnail: string; // data URL
  addedAt: number;
}

interface Collection {
  id: string;
  name: string;
  documentIds: string[];
}

// Database setup
const db = await openDB("DocPlaylist", 1, {
  upgrade(db) {
    db.createObjectStore("documents", { keyPath: "id" });
    db.createObjectStore("collections", { keyPath: "id" });
  },
});

let searchIndex = new MiniSearch({
  fields: ["name"],
  storeFields: ["id", "name", "thumbnail"],
});

async function loadSearchIndex() {
  const docs = await db.getAll("documents");
  searchIndex = new MiniSearch({
    fields: ["name"],
    storeFields: ["id", "name", "thumbnail"],
  });
  searchIndex.addAll(docs);
}

// Sortable item component
function SortableDocument({ doc }: { doc: Document }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg shadow hover:shadow-md transition-shadow p-3 cursor-move ${isDragging ? "z-50" : ""}`}
      {...attributes}
      {...listeners}
    >
      <img src={doc.thumbnail} alt={doc.name} className="w-full h-48 object-cover rounded" />
      <p className="text-sm font-medium mt-2 truncate">{doc.name}</p>
      <div className="flex justify-between items-center mt-2">
        <GripVertical className="w-5 h-5 text-gray-400" />
        <FileText className="w-4 h-4 text-gray-500" />
      </div>
    </div>
  );
}

export default function App() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load everything on start
  useEffect(() => {
    (async () => {
      const savedCollections = (await db.getAll("collections")) || [];
      const savedDocs = (await db.getAll("documents")) || [];
      setCollections(savedCollections.length ? savedCollections : [{ id: "all", name: "All Documents", documentIds: savedDocs.map(d => d.id) }]);
      setDocuments(savedDocs);
      setSelectedCollection(savedCollections[0] || { id: "all", name: "All Documents", documentIds: savedDocs.map(d => d.id) });
      await loadSearchIndex();
    })();
  }, []);

  const createThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      if (file.type === "application/pdf") {
        // Simple PDF first page thumbnail
        const reader = new FileReader();
        reader.onload = () => resolve("/pdf-icon.png"); // We'll use a placeholder for now
        reader.readAsDataURL(file);
      } else {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 280;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, 200, 280);
          resolve(canvas.toDataURL());
        };
        img.src = URL.createObjectURL(file);
      }
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const thumbnail = await createThumbnail(file);
      const doc: Document = {
        id: crypto.randomUUID(),
        name: file.name,
        file,
        thumbnail,
        addedAt: Date.now(),
      };
      await db.put("documents", doc);
      setDocuments(prev => [...prev, doc]);
      searchIndex.add({ id: doc.id, name: doc.name, thumbnail });
    }
  };

  const createCollection = async () => {
    if (!newCollectionName.trim()) return;
    const col: Collection = {
      id: crypto.randomUUID(),
      name: newCollectionName,
      documentIds: [],
    };
    await db.put("collections", col);
    setCollections(prev => [...prev, col]);
    setNewCollectionName("");
    setShowNewCollection(false);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedDocId = active.id as string;
    const targetCollectionId = over.id as string;

    const targetCollection = collections.find(c => c.id === targetCollectionId);
    if (!targetCollection || targetCollection.documentIds.includes(draggedDocId)) return;

    const updatedCollection = {
      ...targetCollection,
      documentIds: [...targetCollection.documentIds, draggedDocId],
    };

    await db.put("collections", updatedCollection);
    setCollections(prev => prev.map(c => c.id === targetCollectionId ? updatedCollection : c));
  };

  const displayedDocs = selectedCollection
    ? documents.filter(doc => 
        selectedCollection.id === "all" || selectedCollection.documentIds.includes(doc.id)
      )
    : documents;

  const filteredDocs = searchQuery
    ? searchIndex.search(searchQuery).map(result => 
        documents.find(d => d.id === result.id)!
      ).filter(Boolean)
    : displayedDocs;

  return (
    <>
      <div className="flex h-screen bg-gray-100">
        {/* Sidebar */}
        <div className="w-64 bg-white shadow-lg p-4 flex flex-col">
          <h1 className="text-2xl font-bold text-blue-600 mb-8">Doc Playlist</h1>
          
          <div className="flex-1 overflow-y-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              {collections.map(collection => (
                <div
                  key={collection.id}
                  onClick={() => setSelectedCollection(collection)}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedCollection?.id === collection.id ? "bg-blue-100 text-blue-700" : "hover:bg-gray-100"
                  }`}
                >
                  <Folder className="w-5 h-5" />
                  <span className="font-medium">{collection.name}</span>
                  <span className="ml-auto text-sm text-gray-500">
                    {collection.id === "all" ? documents.length : collection.documentIds.length}
                  </span>
                </div>
              ))}
            </DndContext>
          </div>

          <button
            onClick={() => setShowNewCollection(true)}
            className="mt-4 flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Collection
          </button>
        </div>

        {/* Main area */}
        <div className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold">{selectedCollection?.name || "Documents"}</h2>
              
              <div className="flex gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-3 border rounded-lg w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <label className="bg-green-600 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-green-700 transition-colors">
                  Upload Documents
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={filteredDocs.map(d => d.id)} strategy={verticalListSortingStrategy}>
                  {filteredDocs.map(doc => (
                    <SortableDocument key={doc.id} doc={doc} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      </div>

      {/* New collection dialog */}
      {showNewCollection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">New Collection</h3>
              <button onClick={() => setShowNewCollection(false)}><X className="w-6 h-6" /></button>
            </div>
            <input
              type="text"
              placeholder="My Receipts 2025"
              value={newCollectionName}
              onChange={e => setNewCollectionName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createCollection()}
              className="w-full px-4 py-3 border rounded-lg mb-4"
              autoFocus
            />
            <button
              onClick={createCollection}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create Collection
            </button>
          </div>
        </div>
      )}
    </>
  );
}