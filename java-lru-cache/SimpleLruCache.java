import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A simple generic LRU cache backed by a HashMap and a doubly linked list.
 * The front of the list is the most recently used entry.
 */
public class SimpleLruCache<K, V> {
    private final int capacity;
    private final Map<K, Node<K, V>> index;
    private Node<K, V> head;
    private Node<K, V> tail;

    public SimpleLruCache(int capacity) {
        validateCapacity(capacity);
        this.capacity = capacity;
        this.index = new HashMap<>();
    }

    public synchronized V get(K key) {
        Node<K, V> node = index.get(key);
        if (node == null) {
            return null;
        }
        moveToFront(node);
        return node.value;
    }

    public synchronized void put(K key, V value) {
        Node<K, V> existing = index.get(key);
        if (existing != null) {
            existing.value = value;
            moveToFront(existing);
            return;
        }

        Node<K, V> node = new Node<>(key, value);
        index.put(key, node);
        attachToFront(node);

        if (index.size() > capacity) {
            evictLeastRecentlyUsed();
        }
    }

    public synchronized V remove(K key) {
        Node<K, V> node = index.remove(key);
        if (node == null) {
            return null;
        }
        detach(node);
        return node.value;
    }

    public synchronized boolean containsKey(K key) {
        return index.containsKey(key);
    }

    public synchronized int size() {
        return index.size();
    }

    public synchronized void clear() {
        index.clear();
        head = null;
        tail = null;
    }

    /**
     * Returns a snapshot ordered from most recently used to least recently used.
     */
    public synchronized Map<K, V> snapshot() {
        Map<K, V> ordered = new LinkedHashMap<>();
        Node<K, V> current = head;
        while (current != null) {
            ordered.put(current.key, current.value);
            current = current.next;
        }
        return ordered;
    }

    @Override
    public synchronized String toString() {
        return snapshot().toString();
    }

    private void moveToFront(Node<K, V> node) {
        if (node == head) {
            return;
        }
        detach(node);
        attachToFront(node);
    }

    private void attachToFront(Node<K, V> node) {
        node.previous = null;
        node.next = head;

        if (head != null) {
            head.previous = node;
        }
        head = node;

        if (tail == null) {
            tail = node;
        }
    }

    private void detach(Node<K, V> node) {
        if (node.previous != null) {
            node.previous.next = node.next;
        } else {
            head = node.next;
        }

        if (node.next != null) {
            node.next.previous = node.previous;
        } else {
            tail = node.previous;
        }

        node.previous = null;
        node.next = null;
    }

    private void evictLeastRecentlyUsed() {
        if (tail == null) {
            return;
        }
        Node<K, V> nodeToRemove = tail;
        detach(nodeToRemove);
        index.remove(nodeToRemove.key);
    }

    // OICQ_INSERT_VALIDATE_CAPACITY
    private static void validateCapacity(int capacity) {
        if(capacity <= 0){
            throw new IllegalArgumentException("capacity must be greater than 0");
        }
    }

    private static final class Node<K, V> {
        private final K key;
        private V value;
        private Node<K, V> previous;
        private Node<K, V> next;

        private Node(K key, V value) {
            this.key = key;
            this.value = value;
        }
    }
}
