package app.melodious.protocol.catalog

/** Where the Logitech tokens live. Implementations must never throw on save. */
interface TokenStore {
    fun load(): CatalogTokens?
    fun save(tokens: CatalogTokens)
    fun clear()
}
